// public deps
const firebase = require('firebase')
const bitmex = require('bitmex-realtime-api')
const moment = require('moment')
const cron = require('cron').CronJob
const util = require('util')

const config = require('./config')

if(!config) return console.error( 'config settings missing, exiting.' )

const methods = require('./methods')

// vars
const timezone = 'Europe/London'
const initSettings = {
    deleteCollectionsOnInit: true,
}

// describe candles
let candles = {
    count: 5, // sharp charts recommends 250 points
    data: [],
    durations: ['1m', '5m', '1h', '1d'],
    indicators: {
        bb: {
            period : 20, 
            stdDev : 2,
            values : [],
        },     
        rsi: {
            period: 14,
            values: [],
        },
        sma: {
            period: 20,
            values: [],
        }
    }
}

// a better console
const x = log => { console.log( util.inspect(log, false, 9, true) ) }

// init firebase
const app = firebase.initializeApp(config.firebase)
const db = app.firestore()
db.settings({ timestampsInSnapshots: true })
initSettings.db = db

// let's do this
!(() => {

    //methods.init(initSettings, candles)

    // // init db in service 
    // Promise.all().then(async () => {
    //     console.log('go')
        
        
    //     let promises = []
    //     let response

    //     candles.durations.forEach(item => {    
            
    //         promises.push( methods.fetchCandleStickData(candles, item) ) 
    //     })

    //     // fetch historical candle stick data first
    //     try { response = await Promise.all(promises) } catch(err){ console.error(err) }

    //     if(!response) return console.error( 'no candlestick data' )
        
    //     // promise all returns array of all promises (duplicated)
    //     candles = response.pop()
        
    //     // run next tick 
    //     promises = []
    //     response = null
    //     candles.durations.forEach(item => {    
            
    //         promises.push( methods.calculateNextTick(candles, item) )
    //     })

    //     try { response = await Promise.all(promises) } catch(err){ console.error(err) }
    
    //     if(!response) return console.error( 'no next tick candle stick data' )
        
    //     // save to db
    //     candles = response.pop()
    //     response = null
        
    //     try { response = await methods.save(candles) } catch(err){ console.error(err) }

    //     if(!response) return console.error( 'could not save candle stick data' )

    //     console.info( 'saved to db successfully' )

    // }).catch(err => console.error( 'something\'s gone wrong' ))
})()