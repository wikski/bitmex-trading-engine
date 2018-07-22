# bitmex-trading-engine

A nodejs engine that continously crawls the BitMEX API and stores data in Google Firestore. 

As well as crawling pricing data, technical indicator values are calculated and stored against the following timeframes: 

* 1 minute
* 5 minute
* 1 hour
* 1 day