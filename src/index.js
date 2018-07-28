// public deps
const firebase = require('firebase')
const util = require('util')

const config = require('./config')

if(!config) return console.error( 'config settings missing, exiting.' )

const methods = require('./methods')

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
    },
    seeded: false,
}

// a better console
global.z = log => { console.log( util.inspect(log, false, 9, true) ) }

// init firebase
const app = firebase.initializeApp(config.firebase)
const db = app.firestore()
db.settings({ timestampsInSnapshots: true })

// let's do this
!(async () => {

    // passively purge db, we'll check it's completion upon initial seed
    methods.purge(db, candles)
    
    // validate purge
    try { await methods.validatePurge(candles) } catch(err){ return console.error( 'could not validate db purge' ) }
    
    // store candles in service
    methods.candles = candles

    // seed initial to kick us off
    try { await methods.seed(1) } catch(err){ return console.error(err) }

    // start cron
    methods.startCron()

    // seed historical
    try { await methods.seed(candles.count) } catch(err){ return console.error(err) }

})()