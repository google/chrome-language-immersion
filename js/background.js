/*
*  Copyright 2014 Google Inc. All rights reserved.
*  
*  Licensed under the Apache License, Version 2.0 (the "License");
*  you may not use this file except in compliance with the License.
*  You may obtain a copy of the License at
*  
*      http://www.apache.org/licenses/LICENSE-2.0
*  
*  Unless required by applicable law or agreed to in writing, software
*  distributed under the License is distributed on an "AS IS" BASIS,
*  WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
*  See the License for the specific language governing permissions and
*  limitations under the License.
*/

"use strict";

/*
 * Language Immersion for Chrome 
 * 
 * Use All Five
 * http://useallfive.com
 * 2012
 *
 */

$(function() {
  BG.initialize();
});


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
    if(typeof this['_' + params['action']] !== 'function') {
      throw "Request action does not have a defined handler";
    }
    
    this['_' + params['action']]({
      'params': params,
      'sender': sender,
      'callback': callback
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
    req.callback(BG.Translation.period_calls);
  },
  
  _predictApiCallLimitFailure: function(req) {
    req.callback((req.params.estimated_calls + BG.Translation.period_calls) > BG.Translation.period_call_limit);
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
    BG.Translation.simulate_api_error = true;
  },
  
  _simulateApiPredictedError: function(req) {
    BG.Translation.period_calls = BG.Translation.period_call_limit;
  }
};

BG.Welcome = {
  initialize: function() {
    if(false === BG.Settings.get('welcome_page_shown')) {
      this.loadPage();
      BG.Settings.set('welcome_page_shown', true);
    }
  },
  
  loadPage: function() {
    chrome.tabs.create({
      'url': chrome.extension.getURL("welcome.html")
    });
  }
};

/**
 * Wrapper around localStorage for all extension settings. Allows
 * values to be stored as-is without being coerced into a string.
 */
BG.Settings = {
  defaults: {
    'active':             true,
    'language':           'es',
    'level':              3,
    'playSounds':         false,
    'underline':          true,
    'experimental':       false,
    'welcome_page_shown': true
  },
  
  /**
   * localStorage key under which all glit settings are stored
   */
  ls_key: 'glit_settings',
  
  local: {
    'develop':            true
  },
  
  initialize: function() {
    // read local storage JSON string into this.local
    if(localStorage[this.ls_key] === undefined) {
      this.local = this.defaults;
      localStorage[this.ls_key] = JSON.stringify(this.defaults);
    } else {
      this.local = JSON.parse(localStorage[this.ls_key]);
    }
  },
  
  /**
   * Accepts either a key/val pair as two arguments, or a single object
   * argument mapping keys to values.
   */
  set: function() {
    if(typeof arguments[0] === 'object') {
      // set multiple key/vals from object
      var obj = arguments[0];
      for(var i in obj) {
        if(obj.hasOwnProperty(i)) {
          this._doSet(i, obj[i]);
        }
      }
    } else if(typeof arguments[0] === 'string') {
      // store single key/val
      this._doSet(arguments[0], arguments[1]);
    }
  },
  
  _doSet: function(key, val) {
    this.local[key] = val;
    
    // stringify local copy and save to LS
    localStorage[this.ls_key] = JSON.stringify(this.local);
  },
  
  /**
   * Accepts either a single string argument, or an array of strings
   */
  get: function() {
    if(typeof arguments[0] === 'string') {
      // single key
      return this._doGet(arguments[0]);
    } else if($.isArray(arguments[0])) {
      // multiple keys as array
      var vals = {};
      for(var i in arguments[0]) {
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
  period_secs: 60,
  period_calls: 0,
  
  api_call_queue: [],
  api_prevent_future_calls: false,
  api_next_call_index: 0,
  api_active_calls: 0,
  period_call_limit: BG.Settings.get('develop') ? 200 : 300, // number of calls allowed every period_secs
  simulate_api_error: false,
  
  api_base_url: "http://translate.google.com/translate_a/t",
  default_request_params: {
    client: "t",
    hl: "en",
    // it: "sel.87638,srcd_gms.2234",
    multires: 1, //0,
    otf: 1, //2,
    // prev: "conf",
    // psl: "en",
    // ptl: "es",
    // sl: "en"
    ssel: 0,
    text: '',

    sl: "auto", // ?
    tl: '', // target language

    pc: 1,
    tsel: 0,
    notlr: 0,
    uptl: '', // ? (takes target language)
    sc: 1
  },
  
  debug: function() {
    period_calls: 0;
    //console.log('period_calls: ', this.period_calls);
    //console.log('api_call_queue: ', this.api_call_queue);
    //console.log('api_prevent_future_calls: ', this.api_prevent_future_calls);
    //console.log('api_active_calls: ', this.api_active_calls);
  },
  
  initialize: function() {
    this.callPeriodTick();
  },
  
  /**
   * Resets properties that hold per-page-translation state
   */
  resetLocalState: function() {
    this.api_call_queue = [];
    this.api_prevent_future_calls = false;
    this.api_next_call_index = 0;
    this.api_active_calls = 0;
  },
  
  /**
   * Resets the API call counter this.period_calls every this.period_secs seconds
   * 
   * @todo use setInterval
   */
  callPeriodTick: function() {
    this.period_calls = 0;
    setTimeout(function() { BG.Translation.callPeriodTick(); }, this.period_secs*1000);
  },
  
  /**
   * Adds a string to the API translation queue. Calls dequeueCalls immediately.
   */
  queueStringTranslation: function(string, lang, callback) {
    var
      that = this,
      decorated_callback = function(response) {
        that.api_active_calls--;

        callback(response);
        that.dequeueCalls();
      };

    this.api_call_queue.push({
      'string': string,
      'lang': lang,
      'callback': decorated_callback
    });

    this.dequeueCalls();
  },
  
  dequeueCalls: function() {
    if(this.api_call_queue.length > 0 && false === this.api_prevent_future_calls) {
      var num_requests = 6 - this.api_active_calls; // queue 6 calls at a time
      num_requests = (num_requests > this.api_call_queue.length) ? this.api_call_queue.length : num_requests;
      
      for(var i=1; i<=num_requests; i++) {
        this.api_active_calls++;
        
        var call_params = this.api_call_queue.shift();
        this.apiTranslateString(call_params['string'], call_params['lang'], call_params['callback']);
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

    if(this.api_prevent_future_calls) {
      return false;
    }

    // increment for calls this period
    this.period_calls++;

    var request_params = this.default_request_params;
    console.log('!!!', string, lang);
    request_params['text'] = string;
    request_params['tl'] = lang;
    request_params['uptl'] = lang;

    var ajax_params = {
      url: this.api_base_url,
      data: request_params,
      type: 'POST',
      success: function(response_data) {
        // Need to fix the raw JSON - google sends back consecutive commas in array notation. Replacing
        // with empty arrays
        response_data = response_data.replace(/,(?=,)/g, ',[]');
        var json_response = JSON.parse(response_data);

        callback(json_response);
      },
      error: function(xhr, textStatus, errorThrown) {
        
        console.error('Error callback called from $.ajax in background.js:apiTranslateString');
        console.error('Text status: ', textStatus);
        console.error('Error thrown: ', errorThrown);
        //console.log(xhr);

        this.api_prevent_future_calls = true;

        console.error(textStatus, errorThrown);
        }
    };

    if(this.simulate_api_error) {
      // since google sends back invalid json, we can force $.ajax to parse json
      // to get the error callback to fire.
      ajax_params['dataType'] = 'json';
    }
    
    //console.log(ajax_params);

    $.ajax(ajax_params);
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
  if(paragraph.length>0) {
    //console.log('PLAY');
    //console.log('http://translate.google.com/translate_tts?tl='+lang+'&q='+paragraph[0]);
    audioElementEven.setAttribute('src', 'http://translate.google.com/translate_tts?tl='+lang+'&q='+paragraph[0]);
    audioElementEven.play();
  }
  if(paragraph.length>1) {
    audioElementOdd.setAttribute('src', 'http://translate.google.com/translate_tts?tl='+lang+'&q='+paragraph[1]);
  }
}


/**
 * Takes a block of text (@sentence) and chops it up into
 * an array, truncating based on (@stringLength), but keeps word entact.
 */
function limitStringWithWordsEntact(sentence, stringLength) {

  sentence = sentence.replace('%', ' ');
  sentence = sentence.replace('"', ' ');
  sentence = sentence.replace("'", ' ');
  sentence = sentence.replace('&', ' ');
  sentence = sentence.replace(')', ' ');
  sentence = sentence.replace('(', ' ');

  var sentenceArray = [];
  var wordArray = sentence.split(' ');
  var lineCounter = 0;
  sentenceArray[0] = '';
  for(var i=0; i<wordArray.length; i++) {

    if(String(sentenceArray[lineCounter] + wordArray[i] + ' ').length < stringLength) {
      sentenceArray[lineCounter] += wordArray[i] + ' ';
    } else if(String(wordArray[i] + ' ').length > stringLength) {
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
  if(aeCount < paragraph.length) {
    audioElementOdd.play();
  }
  if(aeCount+1 < paragraph.length) {
    aeCount++;
    audioElementEven.setAttribute('src', 'http://translate.google.com/translate_tts?tl=es&q='+paragraph[aeCount]);
  }
}, false);

audioElementOdd.addEventListener('ended', function(e) {
  //console.log('ended odd');
  if(aeCount < paragraph.length) {
    audioElementEven.play();
  }
  if(aeCount+1 < paragraph.length) {
    aeCount++;
    audioElementOdd.setAttribute('src', 'http://translate.google.com/translate_tts?tl=es&q='+paragraph[aeCount]);
  }

}, false);

// Wire up the listener.


//-- Set the icon
chrome.browserAction.setIcon({
  path:"/img/logos/logo-27.png"
});
