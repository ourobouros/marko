/*
 * Copyright 2011 eBay Software Foundation
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *    http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */
'use strict';
require('raptor-polyfill/string/startsWith');
var isObjectEmpty = require('raptor-util/isObjectEmpty');
var fs = require('fs');
var nodePath = require('path');

var markoWidgets = require('../');

function isUpperCase(c) {
    return c == c.toUpperCase();
}

function getDefaultWidgetModule(dirname) {
    if (fs.existsSync(nodePath.join(dirname, 'widget.js'))) {
        return './widget';
    } else if (fs.existsSync(nodePath.join(dirname, 'index.js'))) {
        return './';
    } else {
        return null;
    }
}



exports.process =function (node, compiler, template) {
    var props = node.getProperties();


    if (!node._ts) {
        node._ts = Math.random();
    }

    var widgetTypes = [];
    var widgetId;
    var widgetArgs = null;
    var nestedIdExpression;
    var idExpression;
    var widgetElIdExpression;

    var _widgetNode;

    function getWidgetNode() {
        var curNode = node;

        if (_widgetNode !== undefined) {
            return _widgetNode;
        }

        while (true) {
            if (curNode.qName === 'w-widget') {
                _widgetNode = curNode;
                return _widgetNode;
            }

            curNode = curNode.parentNode;
            if (!curNode) {
                break;
            }
        }

        _widgetNode = null;

        return undefined;
    }

    function nextUniqueId() {
        if (template.data.widgetNextElId == null) {
            template.data.widgetNextElId = 0;
        }

        return (template.data.widgetNextElId++);
    }

    function ensureNodeId() {
        // In order to attach a DOM event listener directly we need to make sure
        // the target HTML element has an ID that we can use to get a reference
        // to the element during initialization. We need to handle the following
        // scenarios:
        //
        // 1) The HTML element already has an "id" attribute
        // 2) The HTML element has a "w-el-id" attribute (we already converted this
        //    to an "id" attribute above)
        // 3) The HTML does not have an "id" or "w-el-id" attribute. We must add
        //    an "id" attribute with a unique ID.

        if (nestedIdExpression) {
            return;
        }

        if (node.tag) {
            if (!widgetArgs) {
                widgetArgs = {};
            }

            if (!widgetArgs.id) {
                widgetArgs.id = nextUniqueId();
            }

            idExpression = compiler.makeExpression('widget.elId(' +
                widgetArgs.id +
                ')');

            // Prefix the unique ID with an exclamation point to make it clear that we
            // we need to resolve the ID as a widget element ID.
            nestedIdExpression = compiler.makeExpression(widgetArgs.id);
            return;
        }

        var idAttr = node.getAttribute('id');
        if (idAttr) {
            // Case 1 and 2 -- Using the existing "id" attribute
            // The "id" attribute can be a JavaScript expression or a raw String
            // value. We need a JavaScript expression that can be used to
            // provide the same ID at runtime.

            if (typeof idAttr === 'string') {
                idExpression = compiler.convertType(idAttr, 'string', true);
            } else {
                idExpression = idAttr;
            }

            if (bind) {
                // We have to attach a listener to the root element of the widget
                // We will use an empty string as an indicator that it is the root widget
                // element.
                nestedIdExpression = compiler.makeExpression('""');
            } else if (widgetElIdExpression) {
                // We have to attach a listener to a nested HTML element of the widget
                // that was assigned an ID using "w-id". This ID will not be a fully
                // resolved DOM element ID.
                nestedIdExpression = compiler.makeExpression(widgetElIdExpression.toString());
            } else if (typeof idAttr === 'string') {
                // Convert the raw String to a JavaScript expression. we need to prefix
                // with '#' to make it clear this is a fully resolved element ID
                nestedIdExpression = compiler.makeExpression('"#"+' + idExpression);
            } else {
                // The "id" attribute is already expression but we need to prefix
                // with '#' to make it clear this is a fully resolved element ID
                nestedIdExpression = compiler.makeExpression('"#"+' + idAttr);
            }


        } else {
            // Case 3 - We need to add a unique "id" attribute

            // We'll add a property to keep track of our next widget ID
            // NOTE: This is at compile time and "template.data" is only
            //       used for the current template compilation. We need
            //       a unique ID that
            var uniqueElId = nextUniqueId();

            // Prefix the unique ID with an exclamation point to make it clear that we
            // we need to resolve the ID as a widget element ID.
            nestedIdExpression = compiler.makeExpression(JSON.stringify(uniqueElId));

            idExpression = compiler.makeExpression('widget.elId("' +
                uniqueElId +
                '")');

            node.setAttribute('id', idExpression);
        }

        return nestedIdExpression;
    }

    function registerType(target) {
        var typePathExpression;
        var targetExpression;

        if (compiler.hasExpression(target)) {
            return '__markoWidgets.getDynamicClientWidgetPath(' + compiler.convertType(target, 'string', true) + ')';
        }

        // Resolve the static string to a full path at compile time
        typePathExpression = template.addStaticVar(target === './' ? '__widgetPath' : target, JSON.stringify(markoWidgets.getClientWidgetPath(target, template.dirname)));
        targetExpression = 'require(' + JSON.stringify(target) + ')';

        widgetTypes.push({
            name: typePathExpression,
            target: targetExpression
        });

        template.addStaticCode(function(writer) {
            writer.line('if (typeof window != "undefined") {');
            writer.incIndent();
            widgetTypes.forEach(function(registeredType) {
                writer.line('__markoWidgets.registerWidget(' + registeredType.name + ', ' + registeredType.target + ');');
            });

            writer.decIndent();
            writer.line('}');
        });

        return typePathExpression;
    }

    var bind;

    if ((bind = props['w-bind']) != null) {

        if (bind === '') {
            bind = getDefaultWidgetModule(template.dirname);
            if (!bind) {
                node.addError('Unable to find default widget module when using w-bind without a value');
                return;
            }
        }

        template.addStaticVar('__markoWidgets', 'require("marko-widgets")');

        // A widget is bound to the node
        var widgetAttrsVar = template.addStaticVar('_widgetAttrs', '__markoWidgets.attrs');

        var typePathExpression = registerType(bind);

        var config;
        var id;
        var state;

        var widgetNode = compiler.createTagHandlerNode('w-widget');
        node.parentNode.replaceChild(widgetNode, node);
        widgetNode.appendChild(node);

        widgetNode.setAttribute('module', typePathExpression);

        if ((config = props['w-config'])) {
            widgetNode.setProperty('config', config);
        }

        if ((state = props['w-state'])) {
            widgetNode.setProperty('state', state);
        }

        if ((id = node.getAttribute('id'))) {
            id = compiler.convertType(id, 'string', true);
            widgetNode.setProperty('id', id);
        }

        node.setAttribute('id', '${widget.elId()}');

        node.addDynamicAttributes(template.makeExpression(widgetAttrsVar + '(widget)'));
    } else {
        var widgetExtend;
        var widgetFor;

        widgetArgs = {};

        widgetId = props['w-el-id'];

        if (widgetId) {
            var warning = 'The "w-el-id" attribute is deprecated. Use "w-id" instead. ' + node;
            var pos = node.getPosition();
            if (pos) {
                warning += ' at ' + pos;
            }
            console.log(warning);
        }

        if ((widgetId = widgetId || props['w-id'])) {
            if (node.tag) {
                // Node is a UI component with a widget
                delete props['w-id'];
                widgetArgs.id = widgetId;
            } else {
                // Node is a DOM element
                widgetElIdExpression = widgetId;
                widgetId = null;

                if (node.hasAttribute('id')) {
                    node.addError('The "w-id" attribute cannot be used in conjuction with the "id" attribute');
                } else {
                    node.setAttribute(
                        'id',
                        template.makeExpression('widget.elId(' +
                            widgetElIdExpression.toString() +
                            ')'));
                }
            }

        } else if ((widgetExtend = props['w-extend']) != null) {
            if (widgetExtend === '') {
                widgetExtend = getDefaultWidgetModule(template.dirname);
                if (!widgetExtend) {
                    node.addError('Unable to find default widget module when using w-extend without a value');
                    return;
                }
            }

            node.data.widgetExtend = true;

            node.addNestedVariable('widget');

            // Handle the "w-extend" attribute
            delete props['w-extend'];
            template.addStaticVar('__markoWidgets', 'require("marko-widgets")');
            widgetArgs.extend = registerType(widgetExtend);

            var extendConfig = props['w-config'];

            if (extendConfig) {
                widgetArgs.extendConfig = template.makeExpression(extendConfig);
            } else {
                widgetArgs.extendConfig = template.makeExpression('data.widgetConfig');
            }

            var extendState = props['w-state'];

            if (extendState) {
                widgetArgs.extendState = template.makeExpression(extendState);
            } else {
                widgetArgs.extendState = template.makeExpression('data.widgetState');
            }
        } else if ((widgetFor = props['w-for'])) {
            // Handle the "w-for" attribute
            if (node.hasAttribute('for')) {
                node.addError('The "w-for" attribute cannot be used in conjuction with the "for" attribute');
            } else {
                node.setAttribute(
                    'for',
                    template.makeExpression('widget.elId(' +
                        compiler.convertType(widgetFor, 'string', true) +
                        ')'));
            }
        }
    }

    var widgetBody;
    if ((widgetBody = props['w-body']) != null) {
        if (widgetBody === '') {
            widgetBody = 'data.widgetBody';
        }

        ensureNodeId(node);

        var widgetTagNode = getWidgetNode();
        if (widgetTagNode) {
            widgetTagNode.setProperty('body', nestedIdExpression);            
        }

        node.appendChild(compiler.createNode('w-body', {
            id: idExpression,
            body: widgetBody
        }));
    }

    function addPreserve(bodyOnly) {
        ensureNodeId(node);

        var preserveNode = compiler.createTagHandlerNode('w-preserve');

        preserveNode.setProperty('id', idExpression);

        if (bodyOnly) {
            preserveNode.setProperty('bodyOnly', template.makeExpression(bodyOnly));
        }

        if (bodyOnly) {
            node.forEachChild(function(childNode) {
                preserveNode.appendChild(childNode);
            });

            node.appendChild(preserveNode);
        } else {
            node.parentNode.replaceChild(preserveNode, node);
            preserveNode.appendChild(node);
        }

        return preserveNode;
    }

    var widgetPreserve;
    if ((widgetPreserve = props['w-preserve']) != null) {
        node.removeProperty('w-preserve');
        addPreserve(false);
    }

    var widgetPreserveBody;
    if ((widgetPreserveBody = props['w-preserve-body']) != null) {
        node.removeProperty('w-preserve-body');
        addPreserve(true);
    }

    function addDirectEventListener(eventType, targetMethod) {
        ensureNodeId();

        // The event does not support bubbling, so the widget
        // must attach the listeners directly to the target
        // elements when the widget is initialized.
        var widgetTagNode = getWidgetNode();

        if (!widgetTagNode) {
            node.addError('Unable to handle event "' + eventType + '". HTML element is not nested within a widget.');
            return;
        }


        if (!widgetTagNode.data.widgetEvents) {
            // Add a new input property to the widget tag that will contain
            // enough information to allow the DOM event listeners to
            // be attached directly to the DOM elements.
            widgetTagNode.data.widgetEvents = [];
            widgetTagNode.setProperty('domEvents', function() {
                return compiler.makeExpression(
                    '[' + widgetTagNode.data.widgetEvents.join(',') + ']');
            });
        }

        // Add a 3-tuple consisting of <event-type><target-method>(<DOM element ID>|<widget ID>)
        widgetTagNode.data.widgetEvents.push(JSON.stringify(eventType));
        widgetTagNode.data.widgetEvents.push(JSON.stringify(targetMethod));
        widgetTagNode.data.widgetEvents.push(nestedIdExpression.toString());
    }

    function addBubblingEventListener(eventType, targetMethod) {

        var widgetTagNode = getWidgetNode();

        if (!widgetTagNode) {
            node.addError('Unable to handle event "' + eventType + '". HTML element is not nested within a widget.');
            return;
        }

        node.setAttribute('data-' + propName,
            compiler.makeExpression(JSON.stringify(targetMethod + '|') +
            '+widget.id'));
    }

    function addCustomEventListener(eventType, targetMethod) {
        // Make sure the widget has an assigned scope ID so that we can bind the custom event listener
        if (!widgetArgs) {
            widgetArgs = {};
        }

        // if (!widgetArgs.id) {
        //     var uniqueId = '_' + (template.data.widgetNextId++);
        //     widgetArgs.id = template.makeExpression(JSON.stringify(uniqueId));
        // }

        if (!widgetArgs.customEvents) {
            widgetArgs.customEvents = [];
        }

        widgetArgs.customEvents.push(JSON.stringify(eventType));
        widgetArgs.customEvents.push(JSON.stringify(targetMethod));
    }

    if (node.hasFlag('hasWidgetEvents')) {
        if (!widgetArgs) {
            widgetArgs = {};
        }

        if (!widgetArgs.id) {
            widgetArgs.id = nextUniqueId();
        }

        // The Marko compiler was nice enough to attach a flag to nodes that
        // have one or more attributes that match the "w-on*" pattern.
        // We still need to loop over the properties to find and handle
        // the properties corresponding to those attributes
        for (var propName in props) {
            if (props.hasOwnProperty(propName) && propName.startsWith('w-on')) {
                var eventType = propName.substring(4); // Chop off "w-on"
                var targetMethod = props[propName];

                if (node.tag) {
                    node.removeProperty(propName);
                    // We are adding an event listener for a custom event (not a DOM event)
                    if (eventType.startsWith('-')) {
                        // Remove the leading dash.
                        // Example: w-on-before-show → before-show
                        eventType = eventType.substring(1);
                    } else if (isUpperCase(eventType.charAt(0))) {
                        // Convert first character to lower case:
                        // Example: w-onBeforeShow → beforeShow
                        eventType = eventType.charAt(0).toLowerCase() + eventType.substring(1);
                    }

                    // Node is for a custom tag
                    addCustomEventListener(eventType, targetMethod);
                } else {
                    // We are adding an event listener for a DOM event (not a custom event)
                    //
                    if (eventType.startsWith('-')) {
                        // Remove the leading dash.
                        // Example: w-on-before-show → before-show
                        eventType = eventType.substring(1);
                    }

                    // Normalize DOM event types to be all lower case
                    propName = propName.toLowerCase();

                    // Node is for an HTML element so treat the event as a DOM event
                    var isBubbleEvent = markoWidgets.isBubbleEvent(eventType);

                    if (isBubbleEvent) {
                        // The event is white listed for bubbling so we know that
                        // we have already attached a listener on document.body
                        // that can be used to handle the event. We will add
                        // a "data-w-on{eventType}" attribute to the output HTML
                        // for this element that will be used to map the event
                        // to a method on the containing widget.
                        addBubblingEventListener(eventType, targetMethod);
                    } else {
                        // The event does not bubble so we must attach a DOM
                        // event listener directly to the target element.
                        addDirectEventListener(eventType, targetMethod);
                    }
                }
            }
        }
    }

    if (widgetArgs && !isObjectEmpty(widgetArgs)) {

        template.addStaticVar('_widgetArgs',
            'require("marko-widgets/taglib/helpers").widgetArgs');

        template.addStaticVar('_cleanupWidgetArgs',
            'require("marko-widgets/taglib/helpers").cleanupWidgetArgs');



        node.data.widgetArgs = widgetArgs;

        node.addBeforeCode(function() {
            var widgetArgs = node.data.widgetArgs;

            // Make sure the nested widget has access to the ID of the containing
            // widget if it is needed
            var shouldProvideScope = widgetArgs.id || widgetArgs.customEvents;

            var widgetArgsParts = [shouldProvideScope ? 'widget.id' : 'null'];

            if (widgetArgs.id != null) {
                widgetArgsParts.push(widgetArgs.id.toString());
            } else {
                widgetArgsParts.push('null');
            }

            if (widgetArgs.customEvents) {
                widgetArgsParts.push('[' + widgetArgs.customEvents.join(',') + ']');
            }

            if (widgetArgs.extend) {
                if (!widgetArgs.customEvents) {
                    widgetArgsParts.push('null');
                }

                widgetArgsParts.push(widgetArgs.extend);
                widgetArgsParts.push(widgetArgs.extendConfig);
                widgetArgsParts.push(widgetArgs.extendState);
            }

            return template.makeExpression('_widgetArgs(out, ' + widgetArgsParts.join(', ') + ');');
        });
        node.addAfterCode(template.makeExpression('_cleanupWidgetArgs(out);'));
    }

    if (node.qName === 'w-widget') {
        if (node.getAttribute('id') != null) {
            node.setProperty('scope', template.makeExpression('widget'));
        }
    }
};