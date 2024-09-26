Monitor Text Changes automatically checks all your runs and compares selected fields to their previous versions. This can be used to monitor changes on websites, APIs, or any other data source. 
 
Monitor Text Changes can be run as a standalone Actor but is most useful as an [Integration](https://docs.apify.com/platform/integrations) that runs after your scraping Actor (e.g. [Website Content Crawler](https://apify.com/apify/website-content-crawler)) finishes. 

## How it works
1. Set this Actor as an integration to run after your scraping Actor finishes.
2. Configure the fields to map items (e.g. `url`) and the fields to compare for changes (e.g. `text`) and save the integration.
3. Now Monitor Text Changes will run after all runs of your scraper. You can set the same integration for more Actors.
4. Monitor Text Changes stores all historically scraped items to a named dataset `MONITOR-CHANGES-HISTORICAL-DATA`.
5. Every run uses the [Diff Dataset Fields](https://apify.com/lukaskrivka/diff-dataset-fields) Actor to compare the current run with the historical data. It then pushes all `new` and `updated` items to the default dataset together with a detailed diff (see [Output example](https://apify.com/lukaskrivka/diff-dataset-fields#example-output))
6. After pushing the diff items, it will also push all new and updated items to the historical dataset so it is kept up to date.
7. To get a notification about changes, you can set up a [monitoring alert](https://docs.apify.com/platform/monitoring#alert-configuration) to check if the default dataset has any items. If it does, you can send a notification to your email, Slack, or any other channel.