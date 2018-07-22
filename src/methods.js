const crypto = require('crypto')
const request = require('request')
const moment = require('moment')
const RSI = require('technicalindicators').RSI
const BB = require('technicalindicators').BollingerBands
const SMA = require('technicalindicators').SMA

const config = require('./config')

const _methods = {

    db: null,

    init: (initSettings, candles) => {
        
        const promises = []
        
        _methods.db = initSettings.db

        if(initSettings.deleteCollectionsOnInit){
            
            //promises.concat( _methods.deleteCollections(candles) )
        }
        console.log( _methods.deleteCollections(candles) )
        return promises
    },

    deleteCollections: candles => {
        // start fresh each time to avoid data redundancy issues

        let promises = []

        return new Promise((resolve, reject) => {
                
            candles.durations.forEach(item => {
                // delete all collections

                const collection = _methods.db.collection(`candles-${item}`)
                const batch = _methods.db.batch()

                collection.get().then(snapshot => {            

                    snapshot.docs.forEach(doc => {
                            
                        batch.delete(doc.ref)
                    })
            
                    promises.push( batch.commit() )
                })    
            })    

            Promise.all(promises).then(() => {
                // check the deletion has actually completed

                const records = [candles.count]
                let i = 0

                const recursiveCheck = () => {
                    // firestore deletion request needs time to complete

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

                                    console.info( 'checking firestore documents to delete...' )
                                    i = 1
                                }

                                recursiveCheck() 
                            
                            } else if(total !== 0){

                                if(i !== 2){

                                    console.info( `${total} firestore documents to delete...` )
                                    i = 2
                                }

                                recursiveCheck() 

                            } else {

                                console.info( `${total} firestore documents left to delete` )   
                                
                                return resolve()
                            }
                            
                        }, 500)
                    }
                }

                return recursiveCheck()

            }).catch(err => reject(err))
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
        
        const signature = crypto.createHmac('sha256', config.bitmex.secret).update(str).digest('hex');
        
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
            url: config.bitmex.url + path,
            method: verb,
        }
        
        return new Promise((resolve, reject) => {
            
            return request(options, (error, response, body) => {
                
                if(error) return reject(error)
            
                return resolve(body)
            })
        })
    }, 

    calculateRsi: (candles, duration) => {

        candles.indicators.rsi.values = candles.data.find(item => item.duration === duration).data.map(item => item.close)
        candles.indicators.rsi.values.reverse()
        
        candles.indicators.rsi.tmp = RSI.calculate(candles.indicators.rsi) 
        candles.data.find(item => item.duration === duration).data.map(item => Object.assign(item, { rsi: candles.indicators.rsi.tmp.length ? candles.indicators.rsi.tmp.pop() : null }))
        delete candles.indicators.rsi.tmp
        candles.indicators.rsi.values = []

        console.info( 'rsi processed' )

        return candles
    },

    calculateSma: (candles, duration) => {
            
        candles.indicators.sma.values = candles.data.find(item => item.duration === duration).data.map(item => item.close)
        candles.indicators.sma.values.reverse()

        candles.indicators.sma.tmp = SMA.calculate(candles.indicators.sma)        
        candles.data.find(item => item.duration === duration).data.map(item => Object.assign(item, { sma: candles.indicators.sma.tmp.length ? candles.indicators.sma.tmp.pop() : null }))
        delete candles.indicators.sma.tmp
        candles.indicators.sma.values = []

        console.info( 'sma processed' ) 

        return candles
    },

    calculateBollingerBands: (candles, duration) => {
        
        candles.indicators.bb.values = candles.data.find(item => item.duration === duration).data.map(item => item.close)
        candles.indicators.bb.values.reverse()

        candles.indicators.bb.tmp = BB.calculate(candles.indicators.bb)
        candles.data.find(item => item.duration === duration).data.map(item => Object.assign(item, { bb: candles.indicators.bb.tmp.length ? candles.indicators.bb.tmp.pop() : null }))
        delete candles.indicators.bb.tmp
        candles.indicators.bb.values = []

        console.info( 'bollinger bands processed' )

        return candles
    },

    sanitizeCandleStickData: candles => {

        // remove potential duplicates using timestamp
        candles.data.forEach(item => {
            
            item.data = item.data.filter((obj, pos, arr) => {
                return arr.map(mapObj => mapObj.timestamp).indexOf(obj.timestamp) === pos;
            })
        })

        return candles
    },

    fetchCandleStickData: (candles, duration) => {
        
        // init data
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
                count: candles.count,
                partial: false,                                
                reverse: true,
                symbol: 'XBTUSD',
            }      
            let response
            
            try {
                
                console.info( 'hittin\' up bitmex for candles...' )  
    
                response = await _methods.bitmexApiRequest('/api/v1/trade/bucketed', params, 'GET')            

            } catch(err){ return reject(err) }        
            
            if(response === '[]') return reject('No BitMex data') 
            
            try {

                JSON.parse(response)            
            
            } catch (err){ return reject(err) }          
            
            candles.data[durationIndex].data = [...candles.data[durationIndex].data, ...JSON.parse(response)]
            
            console.info( 'bitmex candles sorted' )

            // saniitize        
            candles = _methods.sanitizeCandleStickData(candles)
                        
            return resolve(candles)
        })
    },

    calculateNextTick: (candles, duration) => {
        
        // fetch latest candlestick data
        candles.count = 1

        return new Promise(async (resolve, reject) => {
                
            let response
            
            try { response = await _methods.fetchCandleStickData(candles, duration) } catch(err){ return reject(err) }

            if(!response) return reject(response)

            // process RSI
            candles = _methods.calculateRsi(response, duration)

            // process SMA
            candles = _methods.calculateSma(candles, duration)

            // process BB
            candles = _methods.calculateBollingerBands(candles, duration)

            return resolve(candles)            
        })
    },

    save: candles => {

        const promises = []
        let response
                
        candles.data.forEach(item => {
            
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

            promises.push( batch.commit() ) 
        })

        return Promise.all(promises)
    }
}

module.exports = _methods