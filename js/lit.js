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
/*
 * Language Immersion for Chrome 
 * 
 * Use All Five
 * http://useallfive.com
 * 2012
 *
 */

/**** chrome.extension localStorage getter/setter wrappers ****/

var set = function(field, value, callback) {
  chrome.extension.sendRequest({
    'action' : 'set',
    'field': field,
    'value': value
  }, callback);
};

var get = function(field, callback) {
  chrome.extension.sendRequest({
    'action' : 'get',
    'field': field
  }, callback);
};

var getMulti = function(fields, callback) {
  chrome.extension.sendRequest({
    'action' : 'getMulti',
    'fields': fields
  }, callback);
};



// make BOM window object available in global namespace
var this_window = this.window;


$(function() {
  
  get('develop', function(develop) {
    log            = console.log.bind(console);
    group          = console.group.bind(console);
    groupCollapsed = console.groupCollapsed.bind(console);
    groupEnd       = console.groupEnd.bind(console);
    
    LIT.initialize();
    
  });
	
});

var LIT = {
	develop: true,
	
  is_active: false,
  translation_level: false,
  language: false,
  url: false,
  max_calls_per_period: 0,
	
	
  initialize: function() {
    var that = this;

    chrome.extension.sendRequest({
      'action':      'pageReload'
    }, function() {
      that.loadConfiguration(function() {
        if(that.url.search('chrome-extension://') !== -1) {
          return false;
        }
        that.doBeginTranslation();
      });
    });
  },
  
  translateForWelcome: function() {
    var that = this;
    
    this.reloadConfiguration(function() {
      LIT.Config.setGlobal('matching_selector', 'example-container');
      that.doBeginTranslation();
    });
  },
  
  doBeginTranslation: function() {
    // check that the extension is enabled
    if(this.is_active === false) {
      return false;
    }
    // show the loading animation
    LIT.DOM.showLoadingAnimation();
    
    // configuration for this translation level (see LIT.Config)
    var current_config = LIT.Config.getCurrent();

    
    // call the appropriate replacement function for this translation level
    LIT.Replacement.reset();
    LIT.Replacement[current_config.wrapping_function]();
  },
	
  loadConfiguration: function(callback) {
    var that = this;

    // background.html should have a request listener to return more than one
    // var in localStorage at a time.
    get('active', function(active) {

      that.is_active = active;
      
      get('level', function(level) {
        that.translation_level = level;
				
        get('language', function(language) {
          that.language = language;
					
          // XXXXXXXXXXX
          try { // content scripts don't have access to tabs? 
            chrome.tabs.getSelected(null, function(tab) {
              that.url = tab.url;
              callback();
            });
          } catch(e) {
            that.url = '';
            callback();
          }
          
        });
      });
    });
  },
  
  // XXXXXX
  reloadConfiguration: function(callback) {
    var that = this;
    
    getMulti(['active', 'level', 'language'], function(response) {
      that.is_active = response['active'];
      that.translation_level = response['level'];
      that.language = response['language'];
      
      callback();
    });
  }
};


LIT.Config = {
  global: {
    'words_per_api_call': 100,
    'show_warning_if_exceeds_call_count': 250,
    'matching_selector': 'body', //, div:not(.lit-warning-dialog, #google-translation-immersion-translating)', // THIS DOESN'T WORK RIGHT NOW - DON'T CHANGE IT
    'min_text_node_length': 50,
    'max_text_node_length': 1500,
    'num_paragraphs': 15 // replace N longest paragraphs on page
  },
  
  levels: {
    /*1: {
      'wrapping_function': 'replaceTopWords',
      'replace_top_num': 30, // replace top 30 words
      'replace_paragraph_cutoff_pct': 50,
      'max_devs_above_mean': 2
    },*/
    
    1: {
      'wrapping_function': 'replaceTopWordsInContext',
      'replace_top_num': 30, // replace top 30 words XXXX
      'replace_paragraph_cutoff_pct': 50,
      'max_devs_above_mean': 2
    },
		
    2: {
      'wrapping_function': 'replaceTopWordsInContext',
      //'replace_top_pct': 10, // replace top 10th percentile of words
      'replace_top_num': 500,
      'replace_paragraph_cutoff_pct': 50,
      'max_devs_above_mean': 2
    },
		
    3: {
      'wrapping_function': 'replaceTopWordsInContext',
      'replace_top_num': 1000,
      'replace_paragraph_cutoff_pct': 50,
      'max_devs_above_mean': 2
    },
		
    4: {
      'wrapping_function': 'replaceTopWordsInContext',
      'replace_top_pct': 75, // replace top 75th percentile of words
      'replace_paragraph_cutoff_pct': 50,
      'max_devs_above_mean': 2
    },
		
    5: {
      'wrapping_function': 'replaceAllParagraphs'
    }
  },
	
  getCurrent: function() {
    if(LIT.translation_level) {
      return this.levels[LIT.translation_level];
    }
		
    return false;
  },
  
  /**
   * Returns the key's value for this level, or the global value of level-specific value is
   * undefined. If no global, then `default` is returned.
   */
  get: function(key, default_val) {
    if(LIT.translation_level && this.levels[LIT.translation_level][key]) {
      return this.levels[LIT.translation_level][key];
    } else if(this.global[key]) {
      return this.global[key];
    } else {
      return default_val;
    }
  },
  
  setGlobal: function(key, val) {
    this.global[key] = val;
  }
};

LIT.Replacement = {
	
  replaced_word_counts: {},
  num_words_replaced: 0,
  replaced_total: 0,
	
  replaced_words: [],
  replaced_paragraphs: [],
	
  // parsed and compiled responses from the API based on the replacement level type
  api_response: false,
  

  reset: function() {
    this.replaced_word_counts = {};
    this.num_words_replaced = 0;
    this.replaced_total = 0;
    this.replaced_words = [];
    this.replaced_paragraphs = [];
    this.api_response = false;
  },


  replaceTopWordsInContext: function() {

    this.parseDocumentTextNodes(LIT.Config.get('matching_selector'), LIT.Config.get('min_text_node_length'), LIT.Config.get('max_text_node_length'));

    var that = this;
    this.predictApiFailure(function() {
      LIT.Translation.translateParagraphList(that.replaced_paragraphs, function(response) {
        that.api_response = response;
        that.interpolateWordsFromResponse();
        that.finalizeTranslation();
      }, LIT.Translation.wordResponseFormatter);
    });
  },
  
  replaceAllParagraphs: function() {
    this.parseDocumentTextNodes(LIT.Config.get('matching_selector'), LIT.Config.get('min_text_node_length'), LIT.Config.get('max_text_node_length'));
    
    var that = this;
    
    this.predictApiFailure(function() {
      LIT.Translation.translateParagraphList(that.replaced_paragraphs, function(response) {
        that.api_response = response;
        
        log('API RESPONSE:', that.api_response);
        
        that.interpolateParagraphsFromResponse();
        that.finalizeTranslation();
      }, LIT.Translation.paragraphResponseFormatter);
    });
  },
  
  predictApiFailure: function(callback) {
    var that = this;
    
    // find out if background.html thinks we'll bust our call allowance
    var estimated_call_count = this.replaced_paragraphs.length;
    
    chrome.extension.sendRequest({
      'action':           'predictApiCallLimitFailure',
      'estimated_calls':  estimated_call_count
    }, function(will_fail) {
    
      // just bail if we will exceed 300 calls
      if(estimated_call_count > 300) {
        LIT.Error.handle('pageTooLarge');
        return false;
      }
      
      if(will_fail) {
        // background.html thinks we're going to exceed that max calls per period if we continue -- bail!
        LIT.Error.handle('apiPredictedCallLimitFailure');
        return false;
      }
      
      // @todo TEST ME
      if(estimated_call_count > LIT.Config.get('show_warning_if_exceeds_call_count')) {
        // show long-loading warning if exceeds config-defined number of calls
        if(confirm("Translating this page might take a long time. Continue?") === false) {
          LIT.Error.handle('userCanceledLongLoad');
          return false;
        }
      }
      
      // get paragraph-level translations
      callback();
    });
  },
  
  /**
   * Triggers all API calls for word and paragraph level translations. Ensures that
   * all API calls have returned before calling `successCallback`
   */
  initiateParagraphLevelTranslation: function() {
    var that = this;
		
    // estimate number of calls to be made here and bail if we're going to exceed our call limit
    var estimated_call_count = Math.ceil(this.replaced_words.length/LIT.Config.global.words_per_api_call) + this.replaced_paragraphs.length;
    
    // request the number of calls already made for this period
    chrome.extension.sendRequest({
      'action':           'predictApiCallLimitFailure',
      'estimated_calls':  estimated_call_count
    }, function(will_fail) {
    
      if(estimated_call_count > 300) {
        LIT.Error.handle('pageTooLarge');
        return false;
      }
      
      if(will_fail) {
        // background.html thinks we're going to exceed that max calls per period if we continue -- bail!
        LIT.Error.handle('apiPredictedCallLimitFailure');
        return false;
      }
      
      // TEST ME
      if(estimated_call_count > LIT.Config.get('show_warning_if_exceeds_call_count')) {
        // show long-loading warning if exceeds certain number of calls
        if(confirm("Translating this page might take a long time. Continue?") === false) {
          LIT.Error.handle('userCanceledLongLoad');
          return false;
        }
      }
      
      // get paragraph-level translations
      LIT.Translation.translateParagraphList(that.replaced_paragraphs, function(response) {
        log('RESPONSE: ', response);
        // throw 'e';
        that.api_responses['paragraph_level'] = response;
        that.finalizeTranslation();
      });
    });
  },

  /**
   * Does everything that needs to be done after we have the translation
   * data back from the API.
   */
  finalizeTranslation: function() {
    LIT.Translation.bindRequestListener();
    
    LIT.DOM.animateReplacements();
		
    // apply highlighting to replacements
    LIT.DOM.applyHighlighting();
		
    // bind events for replacements
    LIT.Replacement.Event.bindReplacementEvents();
		
    // hide the loading animation
    LIT.DOM.hideLoadingAnimation();
		
    // reset background.html
    chrome.extension.sendRequest({
      'action':      'pageComplete'
    }, function() {});
  },
	
  /**
   * Returns an array of words, ordered by popularity, according to this translation
   * level's configuration. Either returns top N words, or top Nth percentile of
   * words. Defaults to top 1000 words.
   */
  getReplacementWordListFromConfig: function() {
    var config, word_list;
		
    config = LIT.Config.getCurrent();
		
    if(config.replace_top_num) {
      // top N words
      word_list = window.common_words.slice(0, config.replace_top_num);
    } else if(config.replace_top_pct) {
      // top Nth percentile of words
      var total = window.common_words.length;
      word_list = window.common_words.slice(0, Math.ceil(total*(config.replace_top_pct/100)));
    } else {
      // default to top 1000 words
      word_list = window.common_words.slice(0, 1000);
    }
		
    return word_list;
  },
	
  /**
   * This is the first pass for word-level replacement. Matches and replaces words
   * in document according to config options, and wraps those matches with
   * firstPassMatchDecorator.
   */
  replaceAllMatchingWords: function(words) {
    var that = this;
		
    var textNodes = this.getAllTextNodes();
    var re_words = new RegExp("(^| )("+ words.join("|") +")([ .,!\"']|$)", 'ig');
    
    
    
    //-- old regex uses lookahead to match words without capturing the trailing
    //-- space, EOL or special char. Useful if you want to highlight consecutive
    //-- words
    //-- var re_words = new RegExp('(^| )('+ words.join('|') +')(?=[ |\.|\,|$])', 'ig');
		
		
    // returns replacement for each word-level RegExp match; used as the 
    // String.replace() method's callback
    var matchReplace = function(match, leading, word, trailing, index) {
      if(that.replaced_word_counts[word]) {
        that.replaced_word_counts[word]++;
      } else {
        that.replaced_word_counts[word] = 1;
        that.num_words_replaced++;
      }
			
      var word_index = that.replaced_words.length;
      that.replaced_words.push(word);
			
      that.replaced_total++;
      num_words_replaced++;
      replaced_length += leading.length + word.length + trailing.length;
			
      // return the decorated word with leading and trailing subexpression matches preserved
      return leading + that.firstPassWordLevelDecorator(word, word_index) + trailing;
    };

		
    for(var i in textNodes) {
      if(textNodes.hasOwnProperty(i)) {
				
        var $node = $(textNodes[i]);
        var inner_text = $node.text();
				
        var total_length = inner_text.length;
        var replaced_length = 0;
        var num_words_replaced = 0;
				
        // only try replacing if this trimmed node is greater than 30 characters
        if(inner_text.trim().length <= 30) {
          continue;
        }
				
        // perform regexp on text node and wrap each match with firstPassMatchDecorator()
        var replaced = inner_text.replace(re_words, matchReplace);
				
        // calculate percentage of text that was replaced, and translate the entire
        // text node if it exceeds the configuration's cutoff
        var replaced_pct = ((replaced_length/total_length)*100);
        var replaced_pct_cutoff = LIT.Config.getCurrent().replace_paragraph_cutoff_pct;
				
				
        if(replaced_pct > replaced_pct_cutoff && num_words_replaced > 5) {
          // cutoff exceeded - replace entire 'paragraph'
					
          // the index for the next sentence pushed onto the array is equal to the
          // current length of the array
          var this_index = this.replaced_paragraphs.length;
					
          this.replaced_paragraphs.push(inner_text);
					
          // decorate the sentence with the match markup
          replaced = this.firstPassParagraphLevelDecorator(inner_text, this_index);
        } else {
          // wrap replaced text in span to preserve leading and trailing text
          replaced = "<span>"+replaced+"</span>";
        }
				
        // insert replaced node before the original text node and delete the original.
        // only replace if the total length of this paragraph is greater than 30 chars.
        $(replaced).insertBefore($node);
        $node.remove();
				
      }
    }
  },
	
  /**
   * Calculate the standard deviation across the number of matches per word in this
   * document. If the variance for one word exceeds @max_devs_above_mean (given as std devs
   * above the mean), then remove every Nth occurrence of the word so as to lower the 
   * total matches to target @max_devs_above_mean. -ADH
   */
  removeMatchesAboveMaxDeviation: function(max_devs_above_mean) {
    var i, j;
		
    // get population's standard deviation
    var population_mean = this.replaced_total / this.num_words_replaced;
    var mean_diff_squares = 0;
		
    for(i in this.replaced_word_counts) {
      if(this.replaced_word_counts.hasOwnProperty(i)) {
        mean_diff_squares += Math.pow((this.replaced_word_counts[i] - population_mean), 2);
      }
    }
		
    var population_std_dev = Math.sqrt(mean_diff_squares/this.num_words_replaced);
		
    for(i in this.replaced_word_counts) {
      if(this.replaced_word_counts.hasOwnProperty(i)) {
				
        var devs_above_mean = ((this.replaced_word_counts[i]-population_mean)/population_std_dev);
				
        if(devs_above_mean > max_devs_above_mean) {
          var to_remove = Math.ceil((devs_above_mean-max_devs_above_mean)*population_std_dev);
          var denominator = Math.ceil(this.replaced_word_counts[i]/to_remove);
          var $matches = $('.gti-match-word-'+i);
					
          if(denominator > 1) {
            for(j=1; j<=this.replaced_word_counts[i]; j++) {
              if(j%denominator === 0) {
                var $match = $($matches[j-1]);
                $match
                .removeClass('gti-match')
                .removeClass('gti-match-word')
                .removeClass('gti-match-word-'+i);
              }
            }
          }
        }
      }
    }
  },
  
  
  interpolateParagraphsFromResponse: function() {
    groupCollapsed('interpolateParagraphsFromResponse');
    // do paragraphs
    for(var i in this.api_response) {
      
      log(this.replaced_paragraphs[i]);
      
      var rp_index = 0;
      for ( var j=this.replaced_paragraphs.length-1; j>=0; j-- ) {
        if ( this.replaced_paragraphs[j].index == i ) {
          $('.gti-match-paragraph-'+i).text('').html(this.finalPassMatchDecorator(this.replaced_paragraphs[j], this.api_response[i]));
        }
      }
      
//      $('.gti-match-paragraph-'+i).text('').html(this.finalPassMatchDecorator(this.replaced_paragraphs[i], this.api_response[i]));
    }
    groupEnd();
  },
  
  interpolateWordsFromResponse: function() {
    var that = this;
    
    for(var i in this.api_response) {
      var replaced = this.interpolateWordTranslationsForString(this.replaced_paragraphs[i].text, this.api_response[i]);
      
      $('.gti-match-paragraph-'+i).text('').html(replaced);
    }
  },
  
  interpolateWordTranslationsForString: function(original, chunk_data) {
    
    var interpolated_string = ''; // what we're returning to the caller
    var compiled_data = this.compileChunkData(chunk_data);
    
    // interpolate the translations
    for(var i in compiled_data) {
      if(compiled_data.hasOwnProperty(i)) {
        interpolated_string += this.doInterpolateSentence(compiled_data[i]['original'], compiled_data[i]['chunks']);
      }
    }
    
    
    /**
     * Since google trims the returned original, and we're rebuilding from that returned
     * original instead of the real original, prepend and append spaces if found
     * in the original.
     */
    if(match = original.match(/^\s+/)) {
      interpolated_string = match[0] + interpolated_string;
    }
    if(match = original.match(/\s+$/)) {
      interpolated_string += match[0];
    }
    
    
    return interpolated_string;
  },
  
  /**
   * Takes the original chunk data object returned from google and compiles it
   * into a structure that's easier to work with
   */
  compileChunkData: function(chunk_data) {
    var rMatchingWords = this.getWordMatchRegexp();
    var rLeadingSpecialChars = /^(\s+)?[,.;:]+.*/;
    
    var compiled_data = [];
    
    for(var i in chunk_data) {
      if(chunk_data.hasOwnProperty(i)) {
        
        var chunk_obj = chunk_data[i];
        
        // check if we started a new sentence
        if(chunk_obj[4]) {
          compiled_data.push({
            'original': chunk_obj[4],
            'chunks': []
          });
        }
        
        // skip those chunks that have more than one substring index (the translated
        // string reference two non-consecutive parts of the sentence.
        if(chunk_obj[3].length > 1) {
          continue;
        }
        
        // skip chunks with missing start/end pointers
        if(chunk_obj[3].length === 0) {
          continue;
        }
        
        var working_indice = compiled_data.length - 1;
        var working_sentence = compiled_data[working_indice]['original'];
        
        var chunk = {
          'substr_start':     chunk_obj[3][0][0],
          'substr_end':       chunk_obj[3][0][1],
          'translated':       chunk_obj[2][0][0],
          'fuzzy_original':   chunk_obj[0]
        };
        chunk['original'] = working_sentence.substring(chunk['substr_start'], chunk['substr_end']); 
        
        
        // skip if the word has leading special characters
        if(null !== chunk['original'].match(rLeadingSpecialChars)) {
          continue;
        }
        
        // @todo skip if contraction
        
        var match = chunk['original'].match(rMatchingWords);
        
        if(null !== match) {
          // XXX store this somewhere and do the STD_DEV removal again
          chunk['matching_word'] = match[2]; // this is the word that got hit by the regexp
          
          compiled_data[working_indice]['chunks'].push(chunk);
        }
      }
    }
    
    return compiled_data;
  },
  
  doInterpolateSentence: function(original_sentence, chunks) {
    // sort the chunks in order of substring start index
    chunks.sort(function(a, b) {
      return a['substr_start'] - b['substr_start'];
    });
    
    
    var interpolated = '';
    var working_index = 0; // references where we're at in original_sentence
    
    for(var i in chunks) {
      if(chunks.hasOwnProperty(i)) {
        
        var chunk = chunks[i];
        
        // fill in plain text between last match and this match
        if(chunk['substr_start'] > working_index) {
          interpolated += original_sentence.substring(working_index, chunk['substr_start']);
        }
        
        // trying to skip consecutive matches, but wasn't working (commented out for now)
        if((chunk['substr_start'] - working_index) <= 1) {
          continue;
        }
        
        // decorate the match
        interpolated += this.finalPassMatchDecorator(chunk['original'], chunk['translated']);
        
        // update the working index
        working_index = chunk['substr_end'];
      }
    }
    
    // tack on any remaining segment of the original_sentence to the ned
    interpolated += original_sentence.substring(working_index) + ' ';
    
    return interpolated;
  },
  
  
  getWordMatchRegexp: function() {
    if(undefined == this.regexp_word_match) {
      this.regexp_word_match = new RegExp("(^| )("+ this.getReplacementWordListFromConfig().join("|") +")([ .,!\"']|$)", 'i');
    }
    
    return this.regexp_word_match;
  },
  
  /**
   * Finds all text nodes under given parent_selector, adds each to this.replaced_paragraphs,
   * and replaces the original text nodes with the first-pass-decorated HTML as a placeholder
   * for when we get the corresponding translations back from Google.
   */
  parseDocumentTextNodes: function(parent_selector, min_text_node_length, max_text_node_length) {
    groupCollapsed('parseDocumentTextNodes');
    var i;
    var textNodes = this.getAllTextNodes(parent_selector);
    for(i in textNodes) {
      if(textNodes.hasOwnProperty(i)) {
        var $node = $(textNodes[i]);
        var inner_text = $node.text();
        
        // valid text node conditions
        var
          cMinLen = (min_text_node_length == false || min_text_node_length === undefined || inner_text.length >= min_text_node_length),
          cMaxLen = (max_text_node_length == false || max_text_node_length === undefined || inner_text.length <= max_text_node_length),
          cNotEmpty = inner_text !== '';
        
        if(cMinLen && cMaxLen && cNotEmpty) {
          var this_index = this.replaced_paragraphs.length;
          this.replaced_paragraphs.push({
            'index':      this_index,
            'text':       inner_text
          });
          
          // decorate the sentence with the match markup
          var replaced = this.textNodePlaceholderDecorator(inner_text, this_index);
          
          log(replaced);
          
          // insert replaced node before the original text node and delete the original
          $(replaced).insertBefore($node);
          $node.remove();
        }
      }
    }
    groupEnd();
  },
	
	
  /**
   * Decorates given text with HTML placeholder span el
   */
  textNodePlaceholderDecorator: function(sentence, index) {
    return '<span class="gti-match gti-match-paragraph gti-match-paragraph-'+index+'">'+sentence+'</span>';
  },
	
  /**
   * Final wrapper for words that have been translated
   */
  finalPassMatchDecorator: function(original, translated) {
  
    if ( original.text ) {
      log(original, translated);
    }
  
    original = ( original.text ) ? original.text : original;
  
    return '<span class="google-translation-immersion-group">'
    +'<span class="google-translation-immersion-original" style="display:none;">'+original+'</span>'
    +'<span class="google-translation-immersion-outer-word-wrap">'
    +'<span class="google-translation-immersion-inner-word-wrap">'+translated+'</span>'
    +'</span>'
    +'</span>';
  },
	
	
  getAllTextNodes: function(parent_selector) {
    groupCollapsed('getAllTextNodes');
    
    var textNodes = [],
        whitespace = /^\s*$/,
        invalid_tags = /^(a|abbr|acronym|cite|code|dfn|embed|fieldset|form|head|iframe|input|kbd|label|link|meta|noscript|option|pre|samp|script|select|style|var)$/i,
        taggy_text = /^\s*(<.+>.+<\/.+>|<.+\/>)\s*$/,
        node;
    
    // XXXXXX this is dirty
    if(parent_selector == 'body') {
      node = document.getElementsByTagName(parent_selector)[0];
    } else {
      node = document.getElementById(parent_selector);
    }
    
    if(node === undefined) {
      return [];
    }
    
    function getTextNodes(node) {
      log(node.tagName);
      // If is text node.
      if ( node.nodeType == 3 ) {
        if ( !whitespace.test(node.nodeValue) && !taggy_text.test(node.nodeValue) ) {
          textNodes.push(node);
        }
      // If a valid element.
      } else if ( node.childNodes && invalid_tags.test(node.tagName) === false ) {
        for ( var i = 0, len = node.childNodes.length; i < len; ++i ) {
          getTextNodes(node.childNodes[i]);
        }
      }
    }

    getTextNodes(node);
    log(textNodes);
    
    groupEnd();
    
    return textNodes;
  }
};

LIT.Translation = {
	
  error_handler_called: false,
  
  translateParagraphList: function(paragraph_list, callback, response_formatter) {
    if(paragraph_list.length == 0) {
      callback({});
      return;
    }
    
    if(LIT.Config.get('num_paragraphs', false)) {
      // sort paragraph list by length, then slice the top N paragraphs for translation
      paragraph_list.sort(function(a, b) {
        return b.text.length - a.text.length;
      });
      paragraph_list = paragraph_list.slice(0, LIT.Config.get('num_paragraphs'));
    }
    
    
    var responses = {};
    var to_translate = paragraph_list.length;
    
		
    for(var i in paragraph_list) {
      if(paragraph_list.hasOwnProperty(i)) {
        var paragraph = paragraph_list[i];
        
        chrome.extension.sendRequest({
          'action':      'queueStringTranslation',
          'string':      paragraph.text,
          'language':    LIT.language
        }, (function() {
          // need to wrap this function to preserve the index in the closure
          var paragraph_index = paragraph.index;
          return function(response) {
            
            if(response === false) {
              LIT.Error.handle('apiHardFailure');
              return false;
            }
            
            responses[paragraph_index] = response;
            
            if((--to_translate) == 0) {
              if($.isFunction(response_formatter)) {
                responses = response_formatter(responses);
              }
              
              callback(responses);
            }
          };
        })());
      }
    }
  },
  
  
  paragraphResponseFormatter: function(responses) {
    var formatted = {};
    
    var re = /\s([.,!])/gi;
    
    for(var i in responses) {
      if(responses.hasOwnProperty(i)) {
        
        var response = responses[i];
        
        formatted[i] = '';
        
        for(var j in response[0]) {
          if(response[0].hasOwnProperty(j)) {

            var fixed = response[0][j][0].replace(re, function(orig, character) {
              return character;
            });
            
            formatted[i] += fixed;
          }
        }
      }
    }
    
    return formatted;
  },
  
  wordResponseFormatter: function(responses) {
    var formatted = {};
    
    for(var i in responses) {
      if(responses.hasOwnProperty(i)) {
        formatted[i] = responses[i][5];
      }
    }
    
    return formatted;
  },

  translateParagraphListOld: function(paragraph_list, callback) {
    if(paragraph_list.length == 0) {
      callback({});
    }
		
    var translated_paragraphs = {};
    var to_translate = paragraph_list.length;
		
    for(var i in paragraph_list) {
      var this_index = i;
      if(paragraph_list.hasOwnProperty(i)) {
        
        chrome.extension.sendRequest({
          'action':      'queueStringTranslation',
          'string':      paragraph_list[i],
          'language':    LIT.language
        }, function() {
          // need to wrap this function to preserve the index in the closure
          var paragraph_index = i;
          return function(response) {
            
            if(response === false) {
              LIT.Error.handle('apiHardFailure');
              return false;
            }
            
            translated_paragraphs[paragraph_index] = '';
            var re = /\s([.,!])/gi;
            
            for(var j in response[0]) {
              if(response[0].hasOwnProperty(j)) {
                var fixed = response[0][j][0].replace(re, function(orig, character) {
                  return character;
                });
                
                translated_paragraphs[paragraph_index] += fixed;
              }
            }
            
            if((--to_translate) == 0) {
              callback(translated_paragraphs);
            }
          };
        }());
      }
    }
  },
	
  bindRequestListener: function() {
    chrome.extension.onRequest.addListener(function(request, sender, sendResponse) {
			
      switch(request.greeting) {
        case 'reload':
          this_window.location.reload(true);
          break;
					
        case 'underline':
          $('span.google-translation-immersion-group').addClass('google-translation-immersion-highlight-sticky');
          break;
				
        case 'removeunderline':
          $('span.google-translation-immersion-group').removeClass('google-translation-immersion-highlight-sticky');
          break;
				
        case 'itemTranslatedComplete':
          if((--LIT.Translator.items_to_translate) === 0) {
            LIT.DOM.hideLoadingAnimation();
          }
          break;
      }
			
    });
  }
};


LIT.Replacement.Event = {
  bindReplacementEvents: function() {
    $("span.google-translation-immersion-group")
    .bind('click', this.onClick)
    .bind('mouseover', this.onMouseover)
    .bind('mouseout', this.onMouseout);
  },
	
  /**
	 * Toggles between translation and original when word is clicked.
	 */
  onClick: function(e) {
    var original = $(this).children('.google-translation-immersion-original');
    var translation = $(this).children('.google-translation-immersion-outer-word-wrap');
	
    if(original.is(":visible")) {
      original.hide();
      translation.show();
    } else {
      original.show();
      translation.hide();
    }
  },
	
  /**
	 * Play translated audio for translated word or sentence on hover
	 */
    
  onMouseover: function(e) {
    var translation = $(this).children('.google-translation-immersion-outer-word-wrap');
    
    get('playSounds', function(doPlaySounds) {
      
      groupCollapsed('LIT:playSounds');
      log(translation.text(), doPlaySounds);
      
      if(doPlaySounds) {
        
        log('doPlaySounds!!');
        
        timeOut = setTimeout( function() {
          
          log('timeout hit!', LIT.language);
          
          chrome.extension.sendRequest({
            action: "playAudio",
            text: translation.text(),
            language: LIT.language
          }, function(response) {});
          
          clearTimeout(timeOut);
        }, 100);
      }
      
      groupEnd();
      
    });
  },
	
  /**
   * Stop playing the audio for the hover event on mouseout
   */
  onMouseout: function(e) {
    get('playSounds', function(doPlaySounds) { 
      if(doPlaySounds) {
        
        chrome.extension.sendRequest({
          action: "stopAudio"
        }, function(response) {});
        
        clearTimeout(timeOut);
      }
    });
  }
};


LIT.Error = {
  error_handled: false,
  
  handle: function(type) {
    if(this.error_handled) {
      return false;
    }
    
    this.error_handled = true;
    this[type]();
  },
  
  cancelTranslation: function(do_disable_plugin) {
    do_disable_plugin = do_disable_plugin || false;
    
    LIT.Translation.bindRequestListener();
		
    LIT.DOM.hideLoadingAnimationNow();
		
    chrome.extension.sendRequest({
      'action': 'pageComplete'
    }, function() {});
    
    if(do_disable_plugin) {
      chrome.extension.sendRequest({
        'action': 'set',
        'field': 'active',
        'value': false
      }, function() {});
    }
  },
  
  apiHardFailure: function() {
    this.cancelTranslation(true);
    
    LIT.DOM.showWarningDialog(
      "Oops, something unexpected happened!",
      "Something bad happened and we couldn't translate this page. This is probably a temporary issue, but we're going to disable the plugin for now. Try waiting a few minutes before re-enabling the plugin."
    );
  },
  
  apiPredictedCallLimitFailure: function() {
    this.cancelTranslation(true);
    
    LIT.DOM.showWarningDialog(
      "Oops, we're translating too fast!",
      "We have to disable translations for now. Please wait a few minutes and re-enable the plugin to start translating again."
    );
  },
  
  userCanceledLongLoad: function() {
    this.cancelTranslation();
  },
  
  pageTooLarge: function() {
    this.cancelTranslation();
    
    LIT.DOM.showWarningDialog(
      "This page is too big to translate",
      "Sorry, this page has too much content for us to translate."
    );
  }
};

/**
 * Houses generic/multi-purpose DOM manipulation functions
 */
LIT.DOM = {
  showLoadingAnimation: function() {
    $("body").append('<div id="google-translation-immersion-translating" style="display:none">Translating</div>');
    $('#google-translation-immersion-translating').fadeIn("slow");		
  },
	
  hideLoadingAnimation: function() {
    $('#google-translation-immersion-translating').fadeOut();
  },
	
  hideLoadingAnimationNow: function() {
    $('#google-translation-immersion-translating').hide();
  },
  
  showWarningDialog: function(title, message, fadeInTime) {
    var that = this;
    fadeInTime = fadeInTime || 200;
    
    var $popup = $('<div class="lit-warning-dialog"><div class="lit-warning-dialog-close"></div><div id="warning-img"></div><h1>'+title+'</h1>'+message+'</div>');
    $popup.hide();
    $('body').append($popup);
    
    $popup.find('.lit-warning-dialog-close').click(function() {
      that.hideWarningDialog();
    });
    
    $popup.fadeIn(fadeInTime);
    
    setTimeout(function() {
      $popup.fadeOut(1500, function() {
        $popup.remove();
      });
    }, 10000);
  },
  
  hideWarningDialog: function(fadeOutTime) {
    fadeOutTime = fadeOutTime || 200;
    
    var $popup = $('.lit-warning-dialog');
    $popup.fadeOut(fadeOutTime, function() {
      $popup.remove();
    });
  },
	
  applyHighlighting: function() {
    get('underline', function(isUnderlined) {
      if(isUnderlined) {
        $('span.google-translation-immersion-group').addClass('google-translation-immersion-highlight-sticky');
      } else {
        $('span.google-translation-immersion-group').removeClass('google-translation-immersion-highlight-sticky');
      }
    });
  },
	
  animateReplacements: function() {
    $('.google-translation-immersion-outer-word-wrap').each(function() {
      //** Logic to find brightness of Text Color **//
      var $outer = $(this);
		  
      var parts = $outer.css('color').match(/^rgb\((\d+),\s*(\d+),\s*(\d+)\)$/)

      delete (parts[0]);
      for (var i = 1; i <= 3; ++i) {
        parts[i] = parseInt(parts[i]).toString(16);
        if (parts[i].length == 1) parts[i] = '0' + parts[i];
      }
      var hexcolor = parts.join('');
      		  
        
      var r = parseInt(hexcolor.substr(0,2),16);
      var g = parseInt(hexcolor.substr(2,2),16);
      var b = parseInt(hexcolor.substr(4,2),16);
      var yiq = ((r*299)+(g*587)+(b*114))/1000;
      
      if(yiq >= 128)
      {
        $outer.parent().addClass('google-translation-immersion-tool-dark-bg');
      }
      //** -/ Logic to find brightness of Text Color **//
			
      var $inner= $outer.children('.google-translation-immersion-inner-word-wrap'),
      width = $outer.outerWidth(),
      options = {
        effect: 'rotateY',
        animTime: 1000
      },
      beforeStart = function() {
        $inner.addClass('google-translation-immersion-highlight google-translation-immersion-'+options.effect);
        setTimeout(start, options.animTime/2);
      },
      start = function() {
        //$inner.html(text);
        $outer.css({
          'width': $inner.width(),
          '-webkit-transition-duration': ((options.animTime/2)/1000)+'s'
        });
        $inner.removeClass('google-translation-immersion-'+options.effect);
        setTimeout(finish, options.animTime/2);
      },
      finish = function() {
        $inner.css({
          '-webkit-transition-duration': ((options.animTime/2)/1000)+'s'
        }).removeClass('google-translation-immersion-highlight');
        setTimeout(afterFinish, options.animTime/2);
      },
      afterFinish = function() {
        $outer.removeAttr('style');
        $inner.removeAttr('style');
      };
      $outer.css({
        'width': width,
        '-webkit-transition-property': 'all',
        '-webkit-transition-duration': '0s',
        '-webkit-transition-timing-function': 'ease',
        '-webkit-transition-delay': 'initial'
      });
		
      $inner.css({
        '-webkit-transition-property': 'all',
        '-webkit-transition-duration': ((options.animTime/2)/1000)+'s',
        '-webkit-transition-timing-function': 'ease',
        '-webkit-transition-delay': 'initial'
      });
	
      beforeStart();
    });
  }
};

var log, group, groupCollapsed, groupEnd;
log = group = groupCollapsed = groupEnd = function() {};
