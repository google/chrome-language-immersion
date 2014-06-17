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


var POPUP = {
  initializeForPopup: function() {
    
    chrome.tabs.getSelected(null, function(tab) {
      var is_welcome = (tab.url.search('chrome-extension://') !== -1) ? true : false;
      
      POPUP.Event.handlers.beforeChange = function(key, callback) {
        callback();
      };
      
      POPUP.Event.handlers.afterChange = function(key, callback) {
        if(is_welcome === false) {
          POPUP.DOM.reloadWindow();
        }
      };
      
      POPUP.DOM.initialize(function() {
        POPUP.Event.register();
      });
    });
  
  },
  
  initializeForWelcome: function() {
    POPUP.Event.handlers.beforeChange = function(key, callback) {
      WELCOME.DOM.resetArticle();
      callback();
    };
    
    POPUP.Event.handlers.afterChange = function(key, callback) {
      LIT.translateForWelcome();
      callback();
    };
    
    POPUP.DOM.initialize(function() {
      POPUP.Event.register();
    });
    
    // pull in changes from master popup every second
    setInterval(function() {
      POPUP.DOM.setStateFromConfig();
    }, 2000);
  }
};

POPUP.Event = {

  handlers: {
    'beforeChange': function(key, callback) {
      console.log('beforeChange');
      if(typeof callback === 'function') {
        callback();
      }
    },
    'afterChange': function(key, callback) {
      console.log('afterChange');
      if(typeof callback === 'function') {
        callback();
      }
    }
  },
  
  doUpdateSetting: function(key, value, funcAfter) {
    funcAfter = funcAfter || function() {};
    
    var that = this;
    
    this.handlers.beforeChange(key, function() {
      console.log('changing...');
      POPUP.Config.requestSet(key, value, function() {
        that.handlers.afterChange(key, funcAfter);
      });
    });
  },
  
  register: function() {
    var that = this;
    
    // language
    $('#glit-popup #language').change(function() {
      that.doUpdateSetting('language', $(this).val());
    });
    
    // speak translation
    $('#glit-popup #check-speak').change(function() {
      that.doUpdateSetting('playSounds', $(this).is(':checked'));
    });
    
    // highlight translation
    $('#glit-popup #check-highlight').change(function() {
      that.doUpdateSetting('underline', $(this).is(':checked'));
    });

    // experimental languages
    $('#check-experimental').change(function() {
      var $check = $(this);
      that.doUpdateSetting('experimental', $check.is(':checked'));
      POPUP.DOM.setExperimentalLanguages($check.is(':checked'));
    });
    
    // fluency
    $('#glit-popup #fluency').mouseup(function() {
      that.doUpdateSetting('level', $(this).val());
    });
    
    // toggle enabled
    $('#glit-popup #toggle li').click(function() {
      console.log('here');
      if(false === $(this).hasClass('selected')) {
        $('#glit-popup #toggle li').toggleClass('selected');
        
        that.doUpdateSetting('active', $('#glit-popup #toggle li.left').hasClass('selected'));
      }
    });
  },
};

POPUP.DOM = {
  initialize: function(callback) {
    //
    // Setup our config menu toggling.
    $('#glit-popup').click(function(e) {
      var on, $trigger;
      // - Figure out our future toggle state.
      on = !$('#config-menu').is(':visible');
      // - If the click isn't from our button, ignore.
      $trigger = $(e.target);
      if ( on && !$trigger.is('#config-button') ) {
        return;
      }
      // - Otherwise toggle the menu as decided.
      $('#config-menu').toggle(on);
    });
    
    this.setStateFromConfig(callback);
  },
  
  setStateFromConfig: function(callback) {
    POPUP.Config.requestGetMulti(['active', 'language', 'level', 'playSounds', 'underline', 'experimental'], function(response) {
      // enabled
      $('#glit-popup #toggle li.'+(response['active'] ? 'left' : 'right')).addClass('selected');
      $('#glit-popup #toggle li.'+(response['active'] === false ? 'left' : 'right')).removeClass('selected');
      
      // language
      $('#glit-popup #language').val(response['language']);
      
      // fluency
      $('#glit-popup #fluency').val(response['level']);
      
      // speak translations
      $('#glit-popup #check-speak').attr('checked', (response['playSounds'] ? 'checked' : false));
      
      // highlight translations
      $('#glit-popup #check-highlight').attr('checked', (response['underline'] ? 'checked' : false));

      // experimental languages
      $('#check-experimental').attr('checked', (response['experimental'] ? 'checked' : false));
      
      if(typeof callback === 'function') {
        callback();
      }
    });
  },
  
  setExperimentalLanguages: function(on) {
    var $menu = $('#language'),
        $all_langs = $menu.children('option'),
        langs = [],
        $lang;
    // - Get and store our option nodes as needed.
    if ( typeof $menu.data('experimental_languages') === 'undefined' ) {
      $all_langs.each(function(idx) {
        $lang = $(this);
        if ( $lang.data('experimental') ) {
          langs[idx] = $lang;
        }
      });
      $menu.data('experimental_languages', langs);
    // - Get stored nodes before toggling.
    } else {
      langs = $menu.data('experimental_languages');
    }
    // - Toggle the nodes. Setting `display` won't work.
    for ( var idx in langs ) {
      if ( langs.hasOwnProperty(idx) ) {
        $lang = langs[idx];
        if ( on ) {
          $lang.insertAfter($all_langs[idx - 1]);
        } else {
          $lang.detach();
        }
      }
    }
  },
  
  reloadWindow: function() {
    chrome.tabs.getSelected(null, function(tab) {
        chrome.tabs.sendRequest(tab.id, {
            greeting: "reload"
        }, function(response) {
            console.log(response.farewell);
        });
    });
  }
};

POPUP.Config = {
  requestSet: function(field, value, callback) {
    console.log(field, value);
    console.log(typeof field, typeof value, typeof callback);
    chrome.extension.sendRequest({
        'action'  : 'set',
        'field'   : field,
        'value'   : value
    }, callback);
  },
  
  requestGet: function(field, callback) {
    chrome.extension.sendRequest({
        'action'  : 'get',
        'field'   : field
    }, callback);
  },
  
  requestGetMulti: function(fields, callback) {
    chrome.extension.sendRequest({
        'action'  : 'getMulti',
        'fields'  : fields
    }, callback);
  },
};
