/*
*    Copyright 2014 Google Inc. All rights reserved.
*
*    Licensed under the Apache License, Version 2.0 (the 'License');
*    you may not use this file except in compliance with the License.
*    You may obtain a copy of the License at
*
*            http://www.apache.org/licenses/LICENSE-2.0
*
*    Unless required by applicable law or agreed to in writing, software
*    distributed under the License is distributed on an 'AS IS' BASIS,
*    WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
*    See the License for the specific language governing permissions and
*    limitations under the License.
*/

'use strict';

/*
 * Language Immersion for Chrome
 *
 * Use All Five
 * http://useallfive.com
 * 2012
 *
 */
/* global $, chrome, console  */

var BG = {
    initialize: function() {
        BG.Settings.initialize();
        BG.Request.initialize();
        // BG.Welcome.initialize();
        BG.Translation.initialize();
    }
};


BG.Request = {
    initialize: function() {
        // hookup request listener
        chrome.extension.onRequest.addListener(function(params, sender, callback) {
            BG.Request.handleRequest(params, sender, callback);
        });
    },
    handleRequest: function(params, sender, callback) {
        if (typeof this['_' + params.action] !== 'function') {
            throw 'Request action does not have a defined handler';
        }

        this['_' + params.action]({
            params: params,
            sender: sender,
            callback: callback
        });
    },

    _pageComplete: function(req) {
        BG.Translation.resetLocalState();
    },

    _pageReload: function(req) {
        BG.Translation.resetLocalState();
        req.callback();
    },

    _queueStringTranslation: function(req) {
        BG.Translation.debug();
        BG.Translation.queueStringTranslation(req.params.string, req.params.language, req.callback);
    },

    _apiTranslateString: function(req) {
        BG.Translation.apiTranslateString(req.params.string, req.params.language, req.callback);
    },

    _getTotalCallsForPeriod: function(req) {
        req.callback(BG.Translation.periodCalls);
    },

    _predictApiCallLimitFailure: function(req) {
        req.callback((req.params.estimatedCalls + BG.Translation.periodCalls) > BG.Translation.periodCallLimit);
    },

    _playAudio: function(req) {
        paragraph = limitStringWithWordsEntact(req.params.text, 95);

        //console.log('play event', paragraph, req.params.language);

        playAudio(req.params.language);
        req.callback();
    },

    _stopAudio: function(req) {
        stopAudio();
        req.callback();
    },

    _getMulti: function(req) {
        req.callback(BG.Settings.get(req.params.fields));
    },

    _get: function(req) {
        req.callback(BG.Settings.get(req.params.field));
    },

    _set: function(req) {
        BG.Settings.set(req.params.field, req.params.value);

        req.callback(req.params.value);
    },

    _simulateApiHardError: function(req) {
        BG.Translation.simulateApiError = true;
    },

    _simulateApiPredictedError: function(req) {
        BG.Translation.periodCalls = BG.Translation.periodCallLimit;
    }
};

BG.Welcome = {
    initialize: function() {
        if (BG.Settings.get('welcomePageShown') === false) {
            this.loadPage();
            BG.Settings.set('welcomePageShown', true);
        }
    },

    loadPage: function() {
        chrome.tabs.create({
            url: chrome.extension.getURL('welcome.html')
        });
    }
};

/**
 * Wrapper around localStorage for all extension settings. Allows
 * values to be stored as-is without being coerced into a string.
 */
BG.Settings = {
    defaults: {
        active: true,
        language: 'es',
        level: 3,
        playSounds: false,
        underline: true,
        experimental: false,
        welcomePageShown: true
    },

    /**
     * localStorage key under which all glit settings are stored
     */
    lsKey: 'glit_settings',

    local: {
        develop: true
    },

    initialize: function() {
        // read local storage JSON string into this.local
        if (localStorage[this.lsKey] === undefined) {
            this.local = this.defaults;
            localStorage[this.lsKey] = JSON.stringify(this.defaults);
        } else {
            this.local = JSON.parse(localStorage[this.lsKey]);
        }
    },

    /**
     * Accepts either a key/val pair as two arguments, or a single object
     * argument mapping keys to values.
     */
    set: function() {
        if (typeof arguments[0] === 'object') {
            // set multiple key/vals from object
            var obj = arguments[0];
            for (var i in obj) {
                if (obj.hasOwnProperty(i)) {
                    this._doSet(i, obj[i]);
                }
            }
        } else if (typeof arguments[0] === 'string') {
            // store single key/val
            this._doSet(arguments[0], arguments[1]);
        }
    },

    _doSet: function(key, val) {
        this.local[key] = val;

        // stringify local copy and save to LS
        localStorage[this.lsKey] = JSON.stringify(this.local);
    },

    /**
     * Accepts either a single string argument, or an array of strings
     */
    get: function() {
        if (typeof arguments[0] === 'string') {
            // single key
            return this._doGet(arguments[0]);
        } else if ($.isArray(arguments[0])) {
            // multiple keys as array
            var vals = {};
            for (var i in arguments[0]) {
                vals[arguments[0][i]] = this._doGet(arguments[0][i]);
            }
            return vals;
        }
    },

    _doGet: function(key) {
        return this.local[key];
    }
};

BG.Translation = {
    periodSecs: 60,
    periodCalls: 0,

    apiCallQueue: [],
    apiPreventFutureCalls: false,
    apiNextCallIndex: 0,
    apiActiveCalls: 0,
    periodCallLimit: BG.Settings.get('develop') ? 200 : 300, // number of calls allowed every periodSecs
    simulateApiError: false,

    apiBaseUrl: 'http://translate.google.com/translate_a/t',
    defaultRequestParams: {
        client: 't',
        hl: 'en',
        // it: 'sel.87638,srcd_gms.2234',
        multires: 1, //0,
        otf: 1, //2,
        // prev: 'conf',
        // psl: 'en',
        // ptl: 'es',
        // sl: 'en'
        ssel: 0,
        text: '',

        sl: 'auto', // ?
        tl: '', // target language

        pc: 1,
        tsel: 0,
        notlr: 0,
        uptl: '', // ? (takes target language)
        sc: 1
    },

    debug: function() {
        periodCalls: 0;
        //console.log('periodCalls: ', this.periodCalls);
        //console.log('apiCallQueue: ', this.apiCallQueue);
        //console.log('apiPreventFutureCalls: ', this.apiPreventFutureCalls);
        //console.log('apiActiveCalls: ', this.apiActiveCalls);
    },

    initialize: function() {
        this.callPeriodTick();
    },

    /**
     * Resets properties that hold per-page-translation state
     */
    resetLocalState: function() {
        this.apiCallQueue = [];
        this.apiPreventFutureCalls = false;
        this.apiNextCallIndex = 0;
        this.apiActiveCalls = 0;
    },

    /**
     * Resets the API call counter this.periodCalls every this.periodSecs seconds
     *
     * @todo use setInterval
     */
    callPeriodTick: function() {
        this.periodCalls = 0;
        setTimeout(function() {
            BG.Translation.callPeriodTick();
        }, this.periodSecs * 1000);
    },

    /**
     * Adds a string to the API translation queue. Calls dequeueCalls immediately.
     */
    queueStringTranslation: function(string, lang, callback) {
        var that = this;

        function decoratedCallback(response) {
            that.apiActiveCalls--;

            callback(response);
            that.dequeueCalls();
        }

        this.apiCallQueue.push({
            string: string,
            lang: lang,
            callback: decoratedCallback
        });

        this.dequeueCalls();
    },

    dequeueCalls: function() {
        if (this.apiCallQueue.length > 0 && this.apiPreventFutureCalls === false) {
            var numRequests = 6 - this.apiActiveCalls; // queue 6 calls at a time
            numRequests = (numRequests > this.apiCallQueue.length) ? this.apiCallQueue.length : numRequests;

            for (var i = 1; i <= numRequests; i = i + 1) {
                this.apiActiveCalls++;

                var callParams = this.apiCallQueue.shift();
                this.apiTranslateString(callParams.string, callParams.lang, callParams.callback);
            }
        }
    },

    /**
     * Calls the translation API given @string and calls @callback
     * with raw response as only parameter
     *
     * This must stay in background.js to avoid x-origin access restrictions
     */
    apiTranslateString: function(string, lang, callback) {

        if (this.apiPreventFutureCalls) {
            return false;
        }

        // increment for calls this period
        this.periodCalls++;

        var requestParams = this.defaultRequestParams;
        requestParams.text = string;
        requestParams.tl = lang;
        requestParams.uptl = lang;

        var ajaxParams = {
            url: this.apiBaseUrl,
            data: requestParams,
            type: 'POST',
            success: function(responseData) {
                // Need to fix the raw JSON - google sends back consecutive commas in array notation. Replacing
                // with empty arrays
                responseData = responseData.replace(/,(?=,)/g, ',[]');
                var jsonResponse = JSON.parse(responseData);

                callback(jsonResponse);
            },
            error: function(xhr, textStatus, errorThrown) {

                console.error('Error callback called from $.ajax in background.js:apiTranslateString');
                console.error('Text status: ', textStatus);
                console.error('Error thrown: ', errorThrown);
                //console.log(xhr);

                this.apiPreventFutureCalls = true;

                console.error(textStatus, errorThrown);
            }
        };

        if (this.simulateApiError) {
            // since google sends back invalid json, we can force $.ajax to parse json
            // to get the error callback to fire.
            ajaxParams.dataType = 'json';
        }

        //console.log(ajaxParams);

        $.ajax(ajaxParams);
    }
};


// Audio Elements
var audioElementEven = document.createElement('audio');
var audioElementOdd = document.createElement('audio');
//We're going to start this at 1, because 0 and 1 play before the loop
var aeCount = 1;
var paragraph = [];


function stopAudio() {
    audioElementEven.pause();
    audioElementOdd.pause();
}

function playAudio(lang) {
    if (paragraph.length > 0) {
        //console.log('PLAY');
        //console.log('http://translate.google.com/translate_tts?tl='+lang+'&q='+paragraph[0]);
        audioElementEven.setAttribute('src', 'http://translate.google.com/translate_tts?tl=' + lang + '&q=' + paragraph[0]);
        audioElementEven.play();
    }
    if (paragraph.length > 1) {
        audioElementOdd.setAttribute('src', 'http://translate.google.com/translate_tts?tl=' + lang + '&q=' + paragraph[1]);
    }
}


/**
 * Takes a block of text (@sentence) and chops it up into
 * an array, truncating based on (@stringLength), but keeps word entact.
 */
function limitStringWithWordsEntact(sentence, stringLength) {

    sentence = sentence.replace('%', ' ');
    sentence = sentence.replace("'", ' ');
    sentence = sentence.replace('"', ' ');
    sentence = sentence.replace('&', ' ');
    sentence = sentence.replace(')', ' ');
    sentence = sentence.replace('(', ' ');

    var sentenceArray = [];
    var wordArray = sentence.split(' ');
    var lineCounter = 0;
    sentenceArray[0] = '';
    for (var i = 0; i < wordArray.length; i++) {

        if (String(sentenceArray[lineCounter] + wordArray[i] + ' ').length < stringLength) {
            sentenceArray[lineCounter] += wordArray[i] + ' ';
        } else if (String(wordArray[i] + ' ').length > stringLength) {
            //skip the word
        } else {
            lineCounter++;
            sentenceArray[lineCounter] = '';
            sentenceArray[lineCounter] += wordArray[i] + ' ';
        }

    }
    return sentenceArray;
}

/**

Event Listeners/Handlers

 */

audioElementEven.addEventListener('waiting', function(e) {
    //console.log('waiting even')
}, false);

audioElementOdd.addEventListener('waiting', function(e) {
    //console.log('waiting odd')
}, false);

audioElementEven.addEventListener('ended', function(e) {
    //console.log('ended even');
    if (aeCount < paragraph.length) {
        audioElementOdd.play();
    }
    if (aeCount + 1 < paragraph.length) {
        aeCount++;
        audioElementEven.setAttribute('src', 'http://translate.google.com/translate_tts?tl=es&q=' + paragraph[aeCount]);
    }
}, false);

audioElementOdd.addEventListener('ended', function(e) {
    //console.log('ended odd');
    if (aeCount < paragraph.length) {
        audioElementEven.play();
    }
    if (aeCount + 1 < paragraph.length) {
        aeCount++;
        audioElementOdd.setAttribute('src', 'http://translate.google.com/translate_tts?tl=es&q=' + paragraph[aeCount]);
    }

}, false);

// Wire up the listener.


//-- Set the icon
chrome.browserAction.setIcon({
    path: '/img/logos/logo-27.png'
});

$(function() {
    BG.initialize();
});
