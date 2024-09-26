import { Actor, log } from 'apify';
import type { ActorRun } from 'apify';

// This Actor will usually run as a webhook but it can be run manually by providing run ID
interface Input {
    runId?: string;
    // These 2 types are stupidly different because webhook payload is wrapped in 'payload' in integrations
    payload?: { resource: ActorRun };
    resource?: ActorRun;
    fieldToMapBy?: string;
    fieldsToDiff?: string[];
}

await Actor.init();

const input = (await Actor.getInput<Input>())!;

const runId = input.runId || input.payload?.resource.id || input.resource?.id;

if (!runId) {
    throw await Actor.exit(`Invalid input: You must provide either 'runId' or start this Actor as a webhook or integration.`);
}

// TODO: For now we only output updated or new items but this could be configurable later
const {
    fieldToMapBy = 'url',
    fieldsToDiff = ['text', 'markdown'],
} = input;

// NOTE: We do everything via calling of Actors so we don't need to load anything into memory

const currentRunDatasetId = (await Actor.apifyClient.run(runId).get())!.defaultDatasetId;

log.info(`Was triggered by run ID: ${runId} with dataset ID: ${currentRunDatasetId}`);

// TODO: This is not an optimally scaling solution but it's a first version,
// maybe we can clean the dataset once a while and archive the rest to a different dataset?
// We will have one mega dataset with all the historical data that we will load and compare on every run and then add to it
// The Diff Dataset Fields Actor will dedup the items in the historical dataset with the same item[fieldToMapBy]
// so that it only compares the last ones, so it naturally works if we always push the last version to the end

const historicalDataset = await Actor.openDataset('MONITOR-CHANGES-HISTORICAL-DATA', { forceCloud: true });

const diffActorInput = {
    oldDatasetId: historicalDataset.id,
    newDatasetId: currentRunDatasetId,
    fieldToMapBy,
    fieldsToDiff,
    outputTypes: ['new', 'updated'],
    // We are storing the diff to this run so it is easier to monitor
    outputDatasetId: Actor.getEnv().defaultDatasetId || undefined,
};

const diffRunInfo = await Actor.call('lukaskrivka/diff-dataset-fields', diffActorInput, { waitSecs: 0 });
log.info(`Diff Actor started with run ID: ${diffRunInfo.id}`);

await Actor.apifyClient.run(diffRunInfo.id).waitForFinish();

log.info(`Diff Actor finished, starting Actor to push to historical dataset`);

// On local, we don't use the outputDatasetId so we load it from the run's default one
const diffOutputDatasetId = diffActorInput.outputDatasetId || diffRunInfo.defaultDatasetId;

// At the end we push current run items to the historical dataset
// We only push items that were new or updated and only the fields that we are diffing to save on storage

const customInputDataInput = { fieldToMapBy, fieldsToDiff, currentRunDatasetId, diffOutputDatasetId };

const historicalPushInput = {
    datasetIds: [customInputDataInput.currentRunDatasetId, customInputDataInput.diffOutputDatasetId],
    outputDatasetId: historicalDataset.id,
    appendDatasetIds: true,
    customInputData: customInputDataInput,
    preDedupTransformFunction: (items: Record<string, unknown>[], { customInputData }: { customInputData: typeof customInputDataInput }) => {
        // eslint-disable-next-line @typescript-eslint/no-shadow
        const { fieldToMapBy, fieldsToDiff, currentRunDatasetId, diffOutputDatasetId } = customInputData;

        const newAndUpdatedDiffs: Record<string, boolean> = {};

        for (const item of items) {
            if (item.__datasetId__ === diffOutputDatasetId && (item.type === 'new' || item.type === 'updated')) {
                const fieldToMapByValue = (item.newItem as Record<string, unknown>)[fieldToMapBy] as string;
                console.log(`Found new or updated diff item: ${fieldToMapByValue}`);
                newAndUpdatedDiffs[fieldToMapByValue] = true;
            }
        }

        console.log(`Found ${Object.keys(newAndUpdatedDiffs).length} new or updated items to push to historical dataset`);

        const toPushHistoricalItems: Record<string, unknown>[] = [];

        for (const item of items) {
            if (item.__datasetId__ === currentRunDatasetId && newAndUpdatedDiffs[item[fieldToMapBy] as string]) {
                const toPush = {
                    __timestamp__: new Date().toISOString(),
                    __datasetId__: currentRunDatasetId,
                    [fieldToMapBy]: item[fieldToMapBy],
                };

                for (const field of fieldsToDiff) {
                    toPush[field] = item[field];
                }
                toPushHistoricalItems.push(toPush);
            }
        }

        console.log(`Pushing ${toPushHistoricalItems.length} items to historical dataset`);

        return toPushHistoricalItems;
    },
};

const historicalPushRun = await Actor.call('lukaskrivka/dedup-datasets', historicalPushInput, { waitSecs: 0 });

log.info(`Push to historical dataset ${historicalDataset.id} started with run ID: ${historicalPushRun.id}`);

await Actor.apifyClient.run(historicalPushRun.id).waitForFinish();

const diffItemCount = (await Actor.apifyClient.dataset(diffOutputDatasetId).get())!.cleanItemCount;

log.info(`Push to historical dataset ${historicalDataset.id} finished.`);

log.info(`There were ${diffItemCount} diffs for [${diffActorInput.outputTypes.join(' or ')}] cases.`);

// NOTE: We would have to sleep for this to have accurate number so it is probably not worth it
// const historicalDatasetItemCount = (await historicalDataset.getInfo())!.itemCount;
// log.info(`Historical dataset now contains ${historicalDatasetItemCount} items.`);

// Gracefully exit the Actor process. It's recommended to quit all Actors with an exit()
await Actor.exit();
