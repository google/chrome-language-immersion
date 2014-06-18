/*
*    Copyright 2014 Google Inc. All rights reserved.
*
*    Licensed under the Apache License, Version 2.0 (the "License");
*    you may not use this file except in compliance with the License.
*    You may obtain a copy of the License at
*
*            http://www.apache.org/licenses/LICENSE-2.0
*
*    Unless required by applicable law or agreed to in writing, software
*    distributed under the License is distributed on an "AS IS" BASIS,
*    WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
*    See the License for the specific language governing permissions and
*    limitations under the License.
*/
/*
 * Language Immersion for Chrome
 *
 * Use All Five
 * http://useallfive.com
 * 2012
 *
 */

/* global $, chrome, console, confirm  */
/**** chrome.extension localStorage getter/setter wrappers ****/

var set = function(field, value, callback) {
    chrome.extension.sendRequest({
        action: 'set',
        field: field,
        value: value
    }, callback);
};

var get = function(field, callback) {
    chrome.extension.sendRequest({
        action: 'get',
        field: field
    }, callback);
};

var getMulti = function(fields, callback) {
    chrome.extension.sendRequest({
        action: 'getMulti',
        fields: fields
    }, callback);
};


var log;
var group;
var groupCollapsed;
var groupEnd;
var timeOut;
log = group = groupCollapsed = groupEnd = function() {};


// make BOM window object available in global namespace
var thisWindow = this.window;


var LIT = {
    develop: true,
    isActive: false,
    translationLevel: false,
    language: false,
    url: false,


    initialize: function() {
        var that = this;

        chrome.extension.sendRequest({
            action: 'pageReload'
        }, function() {
            that.loadConfiguration(function() {
                if (that.url.search('chrome-extension://') !== -1) {
                    return false;
                }
                that.doBeginTranslation();
            });
        });
    },

    translateForWelcome: function() {
        var that = this;

        this.reloadConfiguration(function() {
            LIT.Config.setGlobal('matchingSelector', 'example-container');
            that.doBeginTranslation();
        });
    },

    doBeginTranslation: function() {
        // check that the extension is enabled
        if (this.isActive === false) {
            return false;
        }
        // show the loading animation
        LIT.DOM.showLoadingAnimation();

        // configuration for this translation level (see LIT.Config)
        var currentConfig = LIT.Config.getCurrent();


        // call the appropriate replacement function for this translation level
        LIT.Replacement.reset();
        LIT.Replacement[currentConfig.wrappingFunction]();
    },

    loadConfiguration: function(callback) {
        var that = this;

        // background.html should have a request listener to return more than one
        // var in localStorage at a time.
        get('active', function(active) {

            that.isActive = active;

            get('level', function(level) {
                that.translationLevel = level;

                get('language', function(language) {
                    that.language = language;

                    // XXXXXXXXXXX
                    try { // content scripts don't have access to tabs?
                        chrome.tabs.getSelected(null, function(tab) {
                            that.url = tab.url;
                            callback();
                        });
                    } catch (e) {
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
            that.isActive = response.active;
            that.translationLevel = response.level;
            that.language = response.language;

            callback();
        });
    }
};


LIT.Config = {
    global: {
        wordsPerApiCall: 100,
        showWarningIfExceedsCallCount: 250,
        matchingSelector: 'body', //, div:not(.lit-warning-dialog, #google-translation-immersion-translating)', // THIS DOESN'T WORK RIGHT NOW - DON'T CHANGE IT
        minTextNodeLength: 50,
        maxTextNodeLength: 1500,
        numParagraphs: 15 // replace N longest paragraphs on page
    },

    levels: {
        /*1: {
            'wrappingFunction': 'replaceTopWords',
            'replaceTopNum': 30, // replace top 30 words
            'replaceParagraphCutoffPct': 50,
            'maxDevsAboveMean': 2
        },*/

        1: {
            wrappingFunction: 'replaceTopWordsInContext',
            replaceTopNum: 30, // replace top 30 words XXXX
            replaceParagraphCutoffPct: 50,
            maxDevsAboveMean: 2
        },

        2: {
            wrappingFunction: 'replaceTopWordsInContext',
            //'replaceTopPct': 10, // replace top 10th percentile of words
            replaceTopNum: 500,
            replaceParagraphCutoffPct: 50,
            maxDevsAboveMean: 2
        },

        3: {
            wrappingFunction: 'replaceTopWordsInContext',
            replaceTopNum: 1000,
            replaceParagraphCutoffPct: 50,
            maxDevsAboveMean: 2
        },

        4: {
            wrappingFunction: 'replaceTopWordsInContext',
            replaceTopPct: 75, // replace top 75th percentile of words
            replaceParagraphCutoffPct: 50,
            maxDevsAboveMean: 2
        },

        5: {
            wrappingFunction: 'replaceAllParagraphs'
        }
    },

    getCurrent: function() {
        if (LIT.translationLevel) {
            return this.levels[LIT.translationLevel];
        }

        return false;
    },

    /**
     * Returns the key's value for this level, or the global value of level-specific value is
     * undefined. If no global, then `default` is returned.
     */
    get: function(key, defaultVal) {
        if (LIT.translationLevel && this.levels[LIT.translationLevel][key]) {
            return this.levels[LIT.translationLevel][key];
        } else if (this.global[key]) {
            return this.global[key];
        } else {
            return defaultVal;
        }
    },

    setGlobal: function(key, val) {
        this.global[key] = val;
    }
};

LIT.Replacement = {

    replacedWordCounts: {},
    numWordsReplaced: 0,
    replacedTotal: 0,

    replacedWords: [],
    replacedParagraphs: [],

    // parsed and compiled responses from the API based on the replacement level type
    apiResponse: false,


    reset: function() {
        this.replacedWordCounts = {};
        this.numWordsReplaced = 0;
        this.replacedTotal = 0;
        this.replacedWords = [];
        this.replacedParagraphs = [];
        this.apiResponse = false;
    },


    replaceTopWordsInContext: function() {

        this.parseDocumentTextNodes(LIT.Config.get('matchingSelector'), LIT.Config.get('minTextNodeLength'), LIT.Config.get('maxTextNodeLength'));

        var that = this;
        this.predictApiFailure(function() {
            LIT.Translation.translateParagraphList(that.replacedParagraphs, function(response) {
                that.apiResponse = response;
                that.interpolateWordsFromResponse();
                that.finalizeTranslation();
            }, LIT.Translation.wordResponseFormatter);
        });
    },

    replaceAllParagraphs: function() {
        this.parseDocumentTextNodes(LIT.Config.get('matchingSelector'), LIT.Config.get('minTextNodeLength'), LIT.Config.get('maxTextNodeLength'));

        var that = this;

        this.predictApiFailure(function() {
            LIT.Translation.translateParagraphList(that.replacedParagraphs, function(response) {
                that.apiResponse = response;

                log('API RESPONSE:', that.apiResponse);

                that.interpolateParagraphsFromResponse();
                that.finalizeTranslation();
            }, LIT.Translation.paragraphResponseFormatter);
        });
    },

    predictApiFailure: function(callback) {

        // find out if background.html thinks we'll bust our call allowance
        var estimatedCallCount = this.replacedParagraphs.length;

        chrome.extension.sendRequest({
            action: 'predictApiCallLimitFailure',
            estimatedCalls: estimatedCallCount
        }, function(willFail) {

            // just bail if we will exceed 300 calls
            if (estimatedCallCount > 300) {
                LIT.Error.handle('pageTooLarge');
                return false;
            }

            if (willFail) {
                // background.html thinks we're going to exceed that max calls per period if we continue -- bail!
                LIT.Error.handle('apiPredictedCallLimitFailure');
                return false;
            }

            // @todo TEST ME
            if (estimatedCallCount > LIT.Config.get('showWarningIfExceedsCallCount')) {
                // show long-loading warning if exceeds config-defined number of calls
                if (confirm('Translating this page might take a long time. Continue?') === false) {
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
        var estimatedCallCount = Math.ceil(this.replacedWords.length / LIT.Config.global.wordsPerApiCall) + this.replacedParagraphs.length;

        // request the number of calls already made for this period
        chrome.extension.sendRequest({
            action: 'predictApiCallLimitFailure',
            estimatedCalls: estimatedCallCount
        }, function(willFail) {

            if (estimatedCallCount > 300) {
                LIT.Error.handle('pageTooLarge');
                return false;
            }

            if (willFail) {
                // background.html thinks we're going to exceed that max calls per period if we continue -- bail!
                LIT.Error.handle('apiPredictedCallLimitFailure');
                return false;
            }

            // TEST ME
            if (estimatedCallCount > LIT.Config.get('showWarningIfExceedsCallCount')) {
                // show long-loading warning if exceeds certain number of calls
                if (confirm('Translating this page might take a long time. Continue?') === false) {
                    LIT.Error.handle('userCanceledLongLoad');
                    return false;
                }
            }

            // get paragraph-level translations
            LIT.Translation.translateParagraphList(that.replacedParagraphs, function(response) {
                log('RESPONSE: ', response);
                // throw 'e';
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
            action: 'pageComplete'
        }, function() {});
    },

    /**
     * Returns an array of words, ordered by popularity, according to this translation
     * level's configuration. Either returns top N words, or top Nth percentile of
     * words. Defaults to top 1000 words.
     */
    getReplacementWordListFromConfig: function() {
        var config;
        var wordList;

        config = LIT.Config.getCurrent();

        if (config.replaceTopNum) {
            // top N words
            wordList = window.commonWords.slice(0, config.replaceTopNum);
        } else if (config.replaceTopPct) {
            // top Nth percentile of words
            var total = window.commonWords.length;
            wordList = window.commonWords.slice(0, Math.ceil(total * (config.replaceTopPct / 100)));
        } else {
            // default to top 1000 words
            wordList = window.commonWords.slice(0, 1000);
        }

        return wordList;
    },

    /**
     * This is the first pass for word-level replacement. Matches and replaces words
     * in document according to config options, and wraps those matches with
     * firstPassMatchDecorator.
     */
    replaceAllMatchingWords: function(words) {
        var that = this;

        var textNodes = this.getAllTextNodes();
        var reWords = new RegExp('(^| )(' + words.join('|') + ")([ .,!\"']|$)", 'ig');

        //-- old regex uses lookahead to match words without capturing the trailing
        //-- space, EOL or special char. Useful if you want to highlight consecutive
        //-- words
        //-- var reWords = new RegExp('(^| )('+ words.join('|') +')(?=[ |\.|\,|$])', 'ig');


        // returns replacement for each word-level RegExp match; used as the
        // String.replace() method's callback
        var matchReplace = function(match, leading, word, trailing, index) {
            if (that.replacedWordCounts[word]) {
                that.replacedWordCounts[word] = that.replacedWordCounts[word] + 1;
            } else {
                that.replacedWordCounts[word] = 1;
                that.numWordsReplaced = that.numWordsReplaced + 1;
            }

            var wordIndex = that.replacedWords.length;
            that.replacedWords.push(word);

            that.replacedTotal = that.replacedTotal + 1;
            numWordsReplaced = numWordsReplaced + 1;
            replacedLength += leading.length + word.length + trailing.length;

            // return the decorated word with leading and trailing subexpression matches preserved
            return leading + that.firstPassWordLevelDecorator(word, wordIndex) + trailing;
        };


        for (var i in textNodes) {
            if (textNodes.hasOwnProperty(i)) {

                var $node = $(textNodes[i]);
                var innerText = $node.text();

                var totalLength = innerText.length;
                var replacedLength = 0;
                var numWordsReplaced = 0;

                // only try replacing if this trimmed node is greater than 30 characters
                if (innerText.trim().length <= 30) {
                    continue;
                }

                // perform regexp on text node and wrap each match with firstPassMatchDecorator()
                var replaced = innerText.replace(reWords, matchReplace);

                // calculate percentage of text that was replaced, and translate the entire
                // text node if it exceeds the configuration's cutoff
                var replacedPct = ((replacedLength / totalLength) * 100);
                var replacedPctCutoff = LIT.Config.getCurrent().replaceParagraphCutoffPct;


                if (replacedPct > replacedPctCutoff && numWordsReplaced > 5) {
                    // cutoff exceeded - replace entire 'paragraph'

                    // the index for the next sentence pushed onto the array is equal to the
                    // current length of the array
                    var thisIndex = this.replacedParagraphs.length;

                    this.replacedParagraphs.push(innerText);

                    // decorate the sentence with the match markup
                    replaced = this.firstPassParagraphLevelDecorator(innerText, thisIndex);
                } else {
                    // wrap replaced text in span to preserve leading and trailing text
                    replaced = '<span>' + replaced + '</span>';
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
     * document. If the variance for one word exceeds @maxDevsAboveMean (given as std devs
     * above the mean), then remove every Nth occurrence of the word so as to lower the
     * total matches to target @maxDevsAboveMean. -ADH
     */
    removeMatchesAboveMaxDeviation: function(maxDevsAboveMean) {
        var i;
        var j;

        // get population's standard deviation
        var populationMean = this.replacedTotal / this.numWordsReplaced;
        var meanDiffSquares = 0;

        for (i in this.replacedWordCounts) {
            if (this.replacedWordCounts.hasOwnProperty(i)) {
                meanDiffSquares += Math.pow((this.replacedWordCounts[i] - populationMean), 2);
            }
        }

        var populationStdDev = Math.sqrt(meanDiffSquares / this.numWordsReplaced);

        for (i in this.replacedWordCounts) {
            if (this.replacedWordCounts.hasOwnProperty(i)) {

                var devsAboveMean = ((this.replacedWordCounts[i] - populationMean) / populationStdDev);

                if (devsAboveMean > maxDevsAboveMean) {
                    var toRemove = Math.ceil((devsAboveMean - maxDevsAboveMean) * populationStdDev);
                    var denominator = Math.ceil(this.replacedWordCounts[i] / toRemove);
                    var $matches = $('.gti-match-word-' + i);

                    if (denominator > 1) {
                        for (j = 1; j <= this.replacedWordCounts[i]; j++) {
                            if (j%denominator === 0) {
                                var $match = $($matches[j - 1]);
                                $match
                                .removeClass('gti-match')
                                .removeClass('gti-match-word')
                                .removeClass('gti-match-word-' + i);
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
        for (var i in this.apiResponse) {

            log(this.replacedParagraphs[i]);

            for (var j = this.replacedParagraphs.length - 1; j >= 0; j--) {
                if (this.replacedParagraphs[j].index === i) {
                    $('.gti-match-paragraph-' + i).text('').html(this.finalPassMatchDecorator(this.replacedParagraphs[j], this.apiResponse[i]));
                }
            }

//            $('.gti-match-paragraph-'+i).text('').html(this.finalPassMatchDecorator(this.replacedParagraphs[i], this.apiResponse[i]));
        }
        groupEnd();
    },

    interpolateWordsFromResponse: function() {
        for (var i in this.apiResponse) {
            var replaced = this.interpolateWordTranslationsForString(this.replacedParagraphs[i].text, this.apiResponse[i]);

            $('.gti-match-paragraph-' + i).text('').html(replaced);
        }
    },

    interpolateWordTranslationsForString: function(original, chunkData) {

        var interpolatedString = ''; // what we're returning to the caller
        var compiledData = this.compileChunkData(chunkData);

        // interpolate the translations
        for (var i in compiledData) {
            if (compiledData.hasOwnProperty(i)) {
                interpolatedString += this.doInterpolateSentence(compiledData[i].original, compiledData[i].chunks);
            }
        }


        /**
         * Since google trims the returned original, and we're rebuilding from that returned
         * original instead of the real original, prepend and append spaces if found
         * in the original.
         */
        if (match = original.match(/^\s+/)) {
            interpolatedString = match[0] + interpolatedString;
        }
        if (match = original.match(/\s+$/)) {
            interpolatedString += match[0];
        }


        return interpolatedString;
    },

    /**
     * Takes the original chunk data object returned from google and compiles it
     * into a structure that's easier to work with
     */
    compileChunkData: function(chunkData) {
        var rMatchingWords = this.getWordMatchRegexp();
        var rLeadingSpecialChars = /^(\s+)?[,.;:]+.*/;

        var compiledData = [];

        for (var i in chunkData) {
            if (chunkData.hasOwnProperty(i)) {

                var chunkObj = chunkData[i];

                // check if we started a new sentence
                if (chunkObj[4]) {
                    compiledData.push({
                        original: chunkObj[4],
                        chunks: []
                    });
                }

                // skip those chunks that have more than one substring index (the translated
                // string reference two non-consecutive parts of the sentence.
                if (chunkObj[3].length > 1) {
                    continue;
                }

                // skip chunks with missing start/end pointers
                if (chunkObj[3].length === 0) {
                    continue;
                }

                var workingIndex = compiledData.length - 1;
                var workingSentence = compiledData[workingIndex].original;

                var chunk = {
                    substrStart: chunkObj[3][0][0],
                    substrEnd: chunkObj[3][0][1],
                    translated: chunkObj[2][0][0],
                    fuzzyOriginal: chunkObj[0]
                };
                chunk.original = workingSentence.substring(chunk.substrStart, chunk.substrEnd);


                // skip if the word has leading special characters
                if (chunk.original.match(rLeadingSpecialChars) !== null) {
                    continue;
                }

                // @todo skip if contraction

                var match = chunk.original.match(rMatchingWords);

                if (match !== null) {
                    // XXX store this somewhere and do the STD_DEV removal again
                    chunk.matchingWord = match[2]; // this is the word that got hit by the regexp

                    compiledData[workingIndex].chunks.push(chunk);
                }
            }
        }
        return compiledData;
    },

    doInterpolateSentence: function(originalSentence, chunks) {
        // sort the chunks in order of substring start index
        chunks.sort(function(a, b) {
            return a.substrStart - b.substrStart;
        });


        var interpolated = '';
        var workingIndex = 0; // references where we're at in originalSentence

        for (var i in chunks) {
            if (chunks.hasOwnProperty(i)) {

                var chunk = chunks[i];

                // fill in plain text between last match and this match
                if (chunk.substrStart > workingIndex) {
                    interpolated += originalSentence.substring(workingIndex, chunk.substrStart);
                }

                // trying to skip consecutive matches, but wasn't working (commented out for now)
                if ((chunk.substrStart - workingIndex) <= 1) {
                    continue;
                }

                // decorate the match
                interpolated += this.finalPassMatchDecorator(chunk.original, chunk.translated);

                // update the working index
                workingIndex = chunk.substrEnd;
            }
        }

        // tack on any remaining segment of the originalSentence to the ned
        interpolated += originalSentence.substring(workingIndex) + ' ';

        return interpolated;
    },


    getWordMatchRegexp: function() {
        if (typeof this.regexpWordMatch === undefined) {
            this.regexpWordMatch = new RegExp("(^| )(" + this.getReplacementWordListFromConfig().join("|") + ")([ .,!\"']|$)", 'i');
        }

        return this.regexpWordMatch;
    },

    /**
     * Finds all text nodes under given parentSelector, adds each to this.replacedParagraphs,
     * and replaces the original text nodes with the first-pass-decorated HTML as a placeholder
     * for when we get the corresponding translations back from Google.
     */
    parseDocumentTextNodes: function(parentSelector, minTextNodeLength, maxTextNodeLength) {
        groupCollapsed('parseDocumentTextNodes');
        var i;
        var textNodes = this.getAllTextNodes(parentSelector);
        for (i in textNodes) {
            if (textNodes.hasOwnProperty(i)) {
                var $node = $(textNodes[i]);
                var innerText = $node.text();

                // valid text node conditions
                var cMinLen = (minTextNodeLength === false || minTextNodeLength === undefined || innerText.length >= minTextNodeLength);
                var cMaxLen = (maxTextNodeLength === false || maxTextNodeLength === undefined || innerText.length <= maxTextNodeLength);
                var cNotEmpty = innerText !== '';

                if (cMinLen && cMaxLen && cNotEmpty) {
                    var thisIndex = this.replacedParagraphs.length;
                    this.replacedParagraphs.push({
                        index: thisIndex,
                        text: innerText
                    });

                    // decorate the sentence with the match markup
                    var replaced = this.textNodePlaceholderDecorator(innerText, thisIndex);

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
        return '<span class="gti-match gti-match-paragraph gti-match-paragraph-' + index + '">' + sentence + '</span>';
    },

    /**
     * Final wrapper for words that have been translated
     */
    finalPassMatchDecorator: function(original, translated) {

        if (original.text) {
            log(original, translated);
        }

        original = (original.text) ? original.text : original;

        return '<span class="google-translation-immersion-group">' +
        '<span class="google-translation-immersion-original" style="display:none;">' + original + '</span>' +
        '<span class="google-translation-immersion-outer-word-wrap">' +
        '<span class="google-translation-immersion-inner-word-wrap">' + translated + '</span>' +
        '</span>' +
        '</span>';
    },


    getAllTextNodes: function(parentSelector) {
        groupCollapsed('getAllTextNodes');

        var textNodes = [];
        var whitespace = /^\s*$/;
        var invalid_tags = /^(a|abbr|acronym|cite|code|dfn|embed|fieldset|form|head|iframe|input|kbd|label|link|meta|noscript|option|pre|samp|script|select|style|var)$/i;
        var taggy_text = /^\s*(<.+>.+<\/.+>|<.+\/>)\s*$/;
        var node;

        // XXXXXX this is dirty
        if (parentSelector === 'body') {
            node = document.getElementsByTagName(parentSelector)[0];
        } else {
            node = document.getElementById(parentSelector);
        }

        if (node === undefined) {
            return [];
        }

        function getTextNodes(node) {
            log(node.tagName);
            // If is text node.
            if (node.nodeType === 3) {
                if (!whitespace.test(node.nodeValue) && !taggy_text.test(node.nodeValue)) {
                    textNodes.push(node);
                }
            // If a valid element.
            } else if (node.childNodes && invalid_tags.test(node.tagName) === false) {
                for (var i = 0, len = node.childNodes.length; i < len; ++ i) {
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

    translateParagraphList: function(paragraphList, callback, responseFormatter) {
        if (paragraphList.length === 0) {
            callback({});
            return;
        }

        if (LIT.Config.get('numParagraphs', false)) {
            // sort paragraph list by length, then slice the top N paragraphs for translation
            paragraphList.sort(function(a, b) {
                return b.text.length - a.text.length;
            });
            paragraphList = paragraphList.slice(0, LIT.Config.get('numParagraphs'));
        }


        var responses = {};
        var toTranslate = paragraphList.length;


        for (var i in paragraphList) {
            if (paragraphList.hasOwnProperty(i)) {
                var paragraph = paragraphList[i];

                chrome.extension.sendRequest({
                    action: 'queueStringTranslation',
                    string: paragraph.text,
                    language: LIT.language
                }, (function() {
                    // need to wrap this function to preserve the index in the closure
                    var paragraphIndex = paragraph.index;
                    return function(response) {

                        if (response === false) {
                            LIT.Error.handle('apiHardFailure');
                            return false;
                        }

                        responses[paragraphIndex] = response;

                        if ((-- toTranslate) === 0) {
                            if ($.isFunction(responseFormatter)) {
                                responses = responseFormatter(responses);
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

        for (var i in responses) {
            if (responses.hasOwnProperty(i)) {

                var response = responses[i];

                formatted[i] = '';

                for (var j in response[0]) {
                    if (response[0].hasOwnProperty(j)) {

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

        for (var i in responses) {
            if (responses.hasOwnProperty(i)) {
                formatted[i] = responses[i][5];
            }
        }

        return formatted;
    },

    translateParagraphListOld: function(paragraphList, callback) {
        if (paragraphList.length === 0) {
            callback({});
        }

        var translatedParagraphs = {};
        var toTranslate = paragraphList.length;

        for (var i in paragraphList) {
            if (paragraphList.hasOwnProperty(i)) {

                chrome.extension.sendRequest({
                    action: 'queueStringTranslation',
                    string: paragraphList[i],
                    language: LIT.language
                }, (function() {
                    // need to wrap this function to preserve the index in the closure
                    var paragraphIndex = i;
                    return function(response) {

                        if (response === false) {
                            LIT.Error.handle('apiHardFailure');
                            return false;
                        }

                        translatedParagraphs[paragraphIndex] = '';
                        var re = /\s([.,!])/gi;

                        for (var j in response[0]) {
                            if (response[0].hasOwnProperty(j)) {
                                var fixed = response[0][j][0].replace(re, function(orig, character) {
                                    return character;
                                });

                                translatedParagraphs[paragraphIndex] += fixed;
                            }
                        }

                        if ((-- toTranslate) === 0) {
                            callback(translatedParagraphs);
                        }
                    };
                })());
            }
        }
    },

    bindRequestListener: function() {
        chrome.extension.onRequest.addListener(function(request, sender, sendResponse) {

            switch (request.greeting) {
                case 'reload':
                    thisWindow.location.reload(true);
                    break;

                case 'underline':
                    $('span.google-translation-immersion-group').addClass('google-translation-immersion-highlight-sticky');
                    break;

                case 'removeunderline':
                    $('span.google-translation-immersion-group').removeClass('google-translation-immersion-highlight-sticky');
                    break;

                case 'itemTranslatedComplete':
                    if ((-- LIT.Translator.items_toTranslate) === 0) {
                        LIT.DOM.hideLoadingAnimation();
                    }
                    break;
            }

        });
    }
};


LIT.Replacement.Event = {
    bindReplacementEvents: function() {
        $('span.google-translation-immersion-group')
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

        if (original.is(':visible')) {
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

            if (false) {

                log('doPlaySounds!!');

                timeOut = setTimeout(function() {

                    log('timeout hit!', LIT.language);

                    chrome.extension.sendRequest({
                        action: 'playAudio',
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
            if (doPlaySounds) {

                chrome.extension.sendRequest({
                    action: 'stopAudio'
                }, function(response) {});

                clearTimeout(timeOut);
            }
        });
    }
};


LIT.Error = {
    errorHandled: false,

    handle: function(type) {
        if (this.errorHandled) {
            return false;
        }

        this.errorHandled = true;
        this[type]();
    },

    cancelTranslation: function(doDisablePlugin) {
        doDisablePlugin = doDisablePlugin || false;

        LIT.Translation.bindRequestListener();

        LIT.DOM.hideLoadingAnimationNow();

        chrome.extension.sendRequest({
            action: 'pageComplete'
        }, function() {});

        if (doDisablePlugin) {
            chrome.extension.sendRequest({
                action: 'set',
                field: 'active',
                value: false
            }, function() {});
        }
    },

    apiHardFailure: function() {
        this.cancelTranslation(true);

        LIT.DOM.showWarningDialog(
            'Oops, something unexpected happened!',
            'Something bad happened and we couldn’t translate this page. This is probably a temporary issue, but we’re going to disable the plugin for now. Try waiting a few minutes before re-enabling the plugin.'
        );
    },

    apiPredictedCallLimitFailure: function() {
        this.cancelTranslation(true);

        LIT.DOM.showWarningDialog(
            'Oops, we’re translating too fast!',
            'We have to disable translations for now. Please wait a few minutes and re-enable the plugin to start translating again.'
        );
    },

    userCanceledLongLoad: function() {
        this.cancelTranslation();
    },

    pageTooLarge: function() {
        this.cancelTranslation();

        LIT.DOM.showWarningDialog(
            'This page is too big to translate',
            'Sorry, this page has too much content for us to translate.'
        );
    }
};

/**
 * Houses generic/multi-purpose DOM manipulation functions
 */
LIT.DOM = {
    showLoadingAnimation: function() {
        $('body').append('<div id="google-translation-immersion-translating" style="display:none">Translating</div>');
        $('#google-translation-immersion-translating').fadeIn('slow');
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

        var $popup = $('<div class="lit-warning-dialog"><div class="lit-warning-dialog-close"></div><div id="warning-img"></div><h1>' + title + '</h1>' + message + '</div>');
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
            if (isUnderlined) {
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

            var parts = $outer.css('color').match(/^rgb\((\d+),\s*(\d+),\s*(\d+)\)$/);

            delete (parts[0]);
            for (var i = 1; i <= 3; ++ i) {
                parts[i] = parseInt(parts[i]).toString(16);
                if (parts[i].length === 1) {
                    parts[i] = '0' + parts[i];
                }
            }
            var hexcolor = parts.join('');


            var r = parseInt(hexcolor.substr(0,2),16);
            var g = parseInt(hexcolor.substr(2,2),16);
            var b = parseInt(hexcolor.substr(4,2),16);
            var yiq = ((r * 299) + (g * 587) + (b * 114)) / 1000;

            if (yiq >= 128)
            {
                $outer.parent().addClass('google-translation-immersion-tool-dark-bg');
            }
            //** -/ Logic to find brightness of Text Color **//

            var $inner = $outer.children('.google-translation-immersion-inner-word-wrap');
            var width = $outer.outerWidth();
            var options = {
                effect: 'rotateY',
                animTime: 1000
            };

            function beforeStart() {
                $inner.addClass('google-translation-immersion-highlight google-translation-immersion-' + options.effect);
                setTimeout(start, options.animTime / 2);
            }

            function start() {
                //$inner.html(text);
                $outer.css({
                    width: $inner.width(),
                    '-webkit-transition-duration': ((options.animTime / 2) / 1000) + 's'
                });
                $inner.removeClass('google-translation-immersion-' + options.effect);
                setTimeout(finish, options.animTime / 2);
            }

            function finish() {
                $inner.css({
                    '-webkit-transition-duration': ((options.animTime / 2) / 1000) + 's'
                }).removeClass('google-translation-immersion-highlight');
                setTimeout(afterFinish, options.animTime / 2);
            }

            function afterFinish() {
                $outer.removeAttr('style');
                $inner.removeAttr('style');
            }

            $outer.css({
                width: width,
                '-webkit-transition-property': 'all',
                '-webkit-transition-duration': '0s',
                '-webkit-transition-timing-function': 'ease',
                '-webkit-transition-delay': 'initial'
            });

            $inner.css({
                '-webkit-transition-property': 'all',
                '-webkit-transition-duration': ((options.animTime / 2) / 1000) + 's',
                '-webkit-transition-timing-function': 'ease',
                '-webkit-transition-delay': 'initial'
            });

            beforeStart();
        });
    }
};


$(function() {

    get('develop', function(develop) {
        log                        = console.log.bind(console);
        group                    = console.group.bind(console);
        groupCollapsed = console.groupCollapsed.bind(console);
        groupEnd             = console.groupEnd.bind(console);

        LIT.initialize();

    });

});
