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

/* global $, POPUP, LIT */

var WELCOME = {
    initialize: function() {
        // initialize popup for welcome page
        POPUP.initializeForWelcome();

        // clone and append example article template
        WELCOME.DOM.resetArticle();

        // start animation 300ms after page load
        setTimeout(function() {
            WELCOME.DOM.doMouseAnimation();
        }, 300);
    }
};

WELCOME.DOM = {
    pointerSwitched: false,

    doMouseAnimation: function() {
        var that = this;

        $('#pointer').animate({
            top: '420px',
            left: '41%'
        },
        {
            step: function(now, fx) {
                if (that.pointerSwitched === false && now > 375) {
                    $(this)
                        .removeClass('pointer-arrow')
                        .addClass('pointer-hand');
                    $('.button').addClass('mouse-over');
                    that.pointerSwitched = true;
                }
            },
            complete: function() {
                setTimeout(function() {
                    $('.button').addClass('mouse-down');
                    setTimeout(function() {
                        $('.button').removeClass('mouse-down');

                        setTimeout(function() {
                            var duration = 600;
                            $('#pointer').fadeOut(duration);
                            $('.toolbar-container').animate({
                                height: '0px',
                                marginTop: '735px'
                            }, 600);
                            $('.toolbar').fadeOut(duration);

                            // show the popup
                            $('#glit-popup').fadeIn(duration);

                            // do the translation!
                            LIT.translateForWelcome();

                        }, 100); // pause before fadeout
                    }, 500); // mouse down
                }, 500); // stop and hover
            },
            duration: 1750
        });
    },

    resetArticle: function() {
        $('.example').empty().append($('#example-template').contents().clone());
    }
};

$(function() {
    WELCOME.initialize();
});
