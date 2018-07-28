const crypto = require('crypto')
const request = require('request')
const moment = require('moment-timezone')
const cron = require('cron').CronJob
const RSI = require('technicalindicators').RSI
const BB = require('technicalindicators').BollingerBands
const SMA = require('technicalindicators').SMA

const config = require('./config')

const _methods = {

    candles : null,
    db: null,

    purge: (db, candles) => {
        // purge db each time to avoid data redundancy issues
        
        console.info( 'purging db...' )

        // store db in service
        _methods.db = db
                
        candles.durations.forEach((item, i) => {
            // delete all collections

            const collection = _methods.db.collection(`candles-${item}`)
            const batch = _methods.db.batch()

            collection.get().then(snapshot => {            

                snapshot.docs.forEach(doc => {
                        
                    batch.delete(doc.ref)
                })  
                
                batch.commit()
            })  
        })    
    },

    validatePurge: candles => {
        // check the purge has actually completed first

        const records = [candles.count]
        let i = 0

        return new Promise((resolve, reject) => {
            
            const recursiveCheck = () => {
                // no db records means purge complete

                candles.durations.forEach((item, i) => {              

                    _methods.db.collection(`candles-${item}`).get().then(snapshot => {
                        
                        records[i] = snapshot.size
                    })
                })

                if(records.total !== 0){
                    // keep checking                        

                    setTimeout(() => {                             
                        
                        const total = records.reduce((prev, item) => prev + item)

                        if(records.length !== candles.durations.length){                                

                            if(i !== 1){

                                console.info( 'analyzing firestore documents to purge...' )
                                i = 1
                            }

                            recursiveCheck() 
                        
                        } else if(total !== 0){

                            if(i !== 2){

                                console.info( `${total} firestore documents to purge...` )
                                i = 2
                            }

                            recursiveCheck() 

                        } else {

                            console.info( `purge done` )   
                            
                            return resolve()
                        }
                        
                    }, 500)
                }
            }

            recursiveCheck()
        })
    },

    bitmexApiRequest: (path, params, verb, data) => {
        
        const expires = new Date().getTime() + (60 * 1000)
        
        // build query params
        if(params){

            let tmp = []

            for(let i in params){               

                tmp.push( `${i}=${params[i]}` )
            }
            path += '?' + tmp.join('&')
        }
        
        // handle data
        let str = verb + path + expires
        
        if(data){
            str += JSON.stringify(data)
        }        
        
        const signature = crypto.createHmac('sha256', config.bitmex.secret).update(str).digest('hex')
        
        const headers = {
            'content-type' : 'application/json',
            'Accept': 'application/json',
            'X-Requested-With': 'XMLHttpRequest',
            'api-expires': expires,
            'api-key': config.bitmex.id,
            'api-signature': signature
        }
        const options = {
            headers, 
            url: (config.bitmex.testnet ? config.bitmex.url.replace(/https:\/\/www./,'https://testnet.') : config.bitmex.url) + path,
            method: verb, 
        }
        
        return new Promise((resolve, reject) => {
            
            return request(options, (error, response, body) => {
                
                if(error) return reject(error)
            
                return resolve(body)
            })
        })
    }, 

    calculateRsi: duration => {
        
        _methods.candles.indicators.rsi.values = _methods.candles.data.find(item => item.duration === duration).data.map(item => item.close)
        _methods.candles.indicators.rsi.values.reverse()
        
        _methods.candles.indicators.rsi.tmp = RSI.calculate(_methods.candles.indicators.rsi) 
        _methods.candles.data.find(item => item.duration === duration).data.map(item => Object.assign(item.technicalIndicators, { rsi: _methods.candles.indicators.rsi.tmp.length ? _methods.candles.indicators.rsi.tmp.pop() : null }))
        delete _methods.candles.indicators.rsi.tmp
        _methods.candles.indicators.rsi.values = []

        console.info( `${duration} candle rsi processing done` )
    },

    calculateSma: duration => {
            
        _methods.candles.indicators.sma.values = _methods.candles.data.find(item => item.duration === duration).data.map(item => item.close)
        _methods.candles.indicators.sma.values.reverse()

        _methods.candles.indicators.sma.tmp = SMA.calculate(_methods.candles.indicators.sma)        
        _methods.candles.data.find(item => item.duration === duration).data.map(item => Object.assign(item.technicalIndicators, { sma: _methods.candles.indicators.sma.tmp.length ? _methods.candles.indicators.sma.tmp.pop() : null }))
        delete _methods.candles.indicators.sma.tmp
        _methods.candles.indicators.sma.values = []

        console.info( `${duration} candle sma processing done` )        
    },

    calculateBollingerBands: duration => {
        
        _methods.candles.indicators.bb.values = _methods.candles.data.find(item => item.duration === duration).data.map(item => item.close)
        _methods.candles.indicators.bb.values.reverse()

        _methods.candles.indicators.bb.tmp = BB.calculate(_methods.candles.indicators.bb)
        _methods.candles.data.find(item => item.duration === duration).data.map(item => Object.assign(item.technicalIndicators, { bb: _methods.candles.indicators.bb.tmp.length ? _methods.candles.indicators.bb.tmp.pop() : null }))
        delete _methods.candles.indicators.bb.tmp
        _methods.candles.indicators.bb.values = []

        console.info( `${duration} candle bollinger bands processing done` )        
    },

    sanitizeCandleStickData: candles => {
        
        candles.data.forEach(item => {

            // remove potential duplicates using timestamp
            item.data = item.data.filter((obj, pos, arr) => {
                return arr.map(mapObj => mapObj.timestamp).indexOf(obj.timestamp) === pos;
            })

            item.data.map(iitem => Object.assign(iitem, { technicalIndicators: {} }))
        })

        return candles
    },

    fetchCandleStickData: (candles, duration, count) => {
        
        // init data structure
        if(!Object.keys(candles.data).length){
            
            candles.data = candles.durations.map(item => {
                
                return {
                    duration: item, 
                    data: [],
                }
            })
        }    
        
        const durationIndex = candles.data.findIndex(item => item.duration === duration)
        
        return new Promise(async (resolve, reject) => {
                          
            let params = {
                binSize: duration,
                columns: 'open,close,low,high,trades,volume',
                count,
                partial: false,                                
                reverse: true,
                symbol: 'XBTUSD',
            }      
            let response
            
            try {
                    
                response = await _methods.bitmexApiRequest('/api/v1/trade/bucketed', params, 'GET')            

            } catch(err){ return reject(err) }        
            
            if(response === '[]') return reject('no bitmex data') 
            
            try {
                
                JSON.parse(response)            
            
            } catch (err){ return reject(err) }          
            
            candles.data[durationIndex].data = [...candles.data[durationIndex].data, ...JSON.parse(response)]
            
            // saniitize        
            candles = _methods.sanitizeCandleStickData(candles)
            
            return resolve(candles)
        })
    },

    calculateNextTick: async (candles, duration) => {
        
        // fetch latest candlestick data
        let response
        
        try { response = await _methods.fetchCandleStickData(candles, duration, 1) } catch(err){ return console.error(err) }
        
        if(!response) return console.error(response)

        _methods.candles = response

        _methods.processTechnicalIndicators(duration)        
        
        _methods.save(duration)
    },

    processTechnicalIndicators: duration => {

        // process RSI
        _methods.calculateRsi(duration)

        // process SMA
        _methods.calculateSma(duration)

        // process BB
        _methods.calculateBollingerBands(duration)
    },

    updateListener: (duration, timestamp) => {
        // notify service of udpate

        const item = {
            timestamp,
            updatedAt: moment().utc().format()
        }

        return _methods.db.collection('listeners').doc(`candles-${duration}`).set(item)
    },

    save: duration => {

        const durationIndex = _methods.candles.data.findIndex(item => item.duration === duration)
        const promises = []        
        let response
        
        if(!duration){
            // all timeframes

            _methods.candles.data.forEach(item => {
                
                _methods.processTechnicalIndicators(item.duration)

                const model = _methods.db.collection(`candles-${item.duration}`)
                
                const batch = _methods.db.batch()

                item.data.forEach(iitem => {

                    // add updateAt
                    const updatedAt = moment().utc().format()                
                    iitem = Object.assign(iitem, { updatedAt })
                    
                    // add to batch
                    const doc = model.doc(iitem.timestamp)
                    batch.set(doc, iitem)                               
                })

                if(item.data.length > 1){
                
                    console.info( `${item.duration} candle data ranging from ${item.data[0].timestamp} to ${item.data[item.data.length - 1].timestamp} send to firestore` )                                                        

                } else {

                    console.info( `${item.duration} candle for ${item.data[0].timestamp} sent to firestore` )
                }
                
                promises.push( batch.commit() ) 
            })

        } else {
            // individual timeframe, only save last item
            
            _methods.processTechnicalIndicators(duration)
 
            const item = _methods.candles.data[durationIndex].data.pop()
            
            console.info( `${duration} candle for ${item.timestamp} sent to firestore` )

            promises.push( _methods.db.collection(`candles-${duration}`).doc(item.timestamp).set(item) )
            
            // update listener as well            
            if(_methods.candles.seeded){
                
                promises.push( _methods.updateListener(duration, item.timestamp) )
            }
            
            // mark seed complete
            if(_methods.candles.data[durationIndex].data.length === _methods.candles.count){

                _methods.candles.seeded = true
            }            
        }

        if(duration === '1m'){
            //z( _methods.candles.data[0].data )
        }

        return Promise.all(promises)
    },

    seed: async count => {

        const promises = []
        let response

        _methods.candles.durations.forEach(item => {    
        
            promises.push( _methods.fetchCandleStickData(_methods.candles, item, count) ) 
        })

        try { response = await Promise.all(promises) } catch(err){ return console.error(err) }
        
        _methods.candles = response.pop()

        return _methods.save()
    },

    startCron: async () => {                        

        new cron(`${config.cronBuffer} * * * * *`, async () => {  
            
            const now = moment().tz(config.timezone).startOf('m')            
            const minutes = now.clone().format('mm').split('').map(item => Number(item))            
            const hours = now.clone().format('HH')
            
            // 1 minute ticker
            if(_methods.candles.durations.some(item => item === '1m')){                

                try { await _methods.calculateNextTick(_methods.candles, '1m') } catch(err){ console.error(err) }
            }
   
            // 5 minute ticker
            if(_methods.candles.durations.some(item => item === '5m') && [0, 5].some(item => item === minutes[1])){
                
                try { await _methods.calculateNextTick(_methods.candles, '5m') } catch(err){ console.error(err) }
            }    
 
            // 1 hour ticker
            if(_methods.candles.durations.some(item => item === '1h') && minutes[0] === 0 && minutes[1] === 0){

                try { await _methods.calculateNextTick(_methods.candles, '1h') } catch(err){ console.error(err) }
            } 
            
            // 1 day ticker
            if(_methods.candles.durations.some(item => item === '1d') && hours === '00' && minutes[0] === 0 && minutes[1] === 0){
                
                try { await _methods.calculateNextTick(_methods.candles, '1d') } catch(err){ console.error(err) }
            }
            
        }, null, true, config.timezone)
    },
}

module.exports = _methods