/*jslint node: true, closure: true, plusplus: true, vars: true, regexp: true, nomen: true*/

"use strict";


var restify = require('restify-clients');
var fs = require('fs');
var async = require('async');

//static definitions
var fileNames = {
        'state': 'state.txt'
    };

//commands used to control the heat pump
//all capabilties are listed here, they get enabled if the capabitlies of the
//unit allow for particular command
var capabilitiesMap = {
    "action": {
        "mode": "MD",
        "fan": "FS",
        "power": "PW",
        "temperature": "TS",
        "airDirH": "AH", //hasairdirh
        "airDirV": "AV"  //hasairdir
    },
    "mode": {
        "heat": "1",
        "dry": "2",     //hasdrymode
        "cool": "3",
        "fan": "7",
        "auto": "8"     //hasautomode
    },
    "power": {
        "on": "1",
        "off": "0"
    },
    "fan": {
        "auto": "0",    //hasautofan
        "1": {          //fanstage: 1
            "1": "5"
        },
        "2": {          //fanstage: 2
            "1": "2",
            "2": "5"
        },
        "3": {          //fanstage: 3
            "1": "2",
            "2": "3",
            "3": "5"
        },
        "4": {          //fanstage: 4
            "1": "2",
            "2": "3",
            "3": "5",
            "4": "6"
        },
        "5": {          //fanstage: 5
            "1": "1",
            "2": "2",
            "3": "3",
            "4": "5",
            "5": "6"
        }
    },
    "airDirH": {
        "1": {          //hasairdirh
            "auto": "0",
            "1": "1",
            "2": "2",
            "3": "3",
            "4": "4",
            "5": "5",
            "swing": "12"
        }
    },
    "airDirV": {
        "auto": "0",    //hasairauto
        "1": {          //hasairdir
            "1": "1",
            "2": "2",
            "3": "3",
            "4": "4",
            "5": "5"
        },
        "swing": "7"    //hasswing
    }
};

//filters used to check if functionality is present
var capabilitiesMapFilter = {
    "action": {
        "airDirH": {
            "capability" : "hasairdirh",
            "value": "1"
        },
        "airDirV": {
            "capability" : "hasairdir",
            "value": "1"
        }
    },
    "mode": {
        "dry": {
            "capability" : "hasdrymode",
            "value": "1"
        },
        "auto": {
            "capability": "hasautomode",
            "value": "1"
        }
    },
    "fan": {
        "auto": {
            "capability" : "hasautofan",
            "value": "1"
        },
        "1": {
            "capability" : "fanstage",
            "value": "1",
            "copySubsection": true
        },
        "2": {
            "capability" : "fanstage",
            "value": "2",
            "copySubsection": true
        },
        "3": {
            "capability" : "fanstage",
            "value": "3",
            "copySubsection": true
        },
        "4": {
            "capability" : "fanstage",
            "value": "4",
            "copySubsection": true
        },
        "5": {
            "capability" : "fanstage",
            "value": "5",
            "copySubsection": true
        }
    },
    "airDirV": {
        "auto": {
            "capability" : "hasairauto",
            "value": "1"
        },
        "swing": {
            "capability" : "hasswing",
            "value": "1"
        },
        "1": {
            "capability" : "hasairdir",
            "value": "1",
            "copySubsection": true
        }
    },
    "airDirH": {
        "1": {
            "capability" : "hasairdirh",
            "value": "1",
            "copySubsection": true
        }
    }
};

//REST call points
var APICommands = {
        'login': {
            url: 'api/login.aspx'
        },
        'unitcapabilities': {
            url:  'api/unitcapabilities.aspx'
        },
        'unitcommand': {
            url:  'api/unitcommand.aspx'
        }
    };

var appVersion = '3.0.513';

//only these capabilties are stored in the session file
var knownCapabilities = [
    'id',
    'unitname',
    'modeltype',
    'fanstage',
    'hasairdir',
    'hasswing',
    'hasautomode',
    'hasautofan',
    'hasdrymode',
    'hasairauto',
    'hasairdirh',
    'max'
];


/**
 * @class This provides all the connectivity methods
 * @author lennyb
     * @param {object} params parameters used to create the class:
     *                        url - the address the heat pump API resides at (default: https://api.melview.net/)
     *                        username - the username (email address) used at the Mitsubishi site/in the app (required)
     *                        password - the password used at the Mitsubishi site/in the app (required)
     *                        userAgent - the userAgent the requests should use (default: restify default)
     *                        log - bunyan log object, MMcontrol will log using a child of (module=MMcontrol)
     *                        minRefresh - the amount of time (in seconds) MMcontrol will wait before querying the API again to refreash the state of the heat pump(other requests are send immiedietaly)
     *                        tmpDir - directory used to store temporary files (cookies, capabilites and state if persistence is enabled)
     *                        persistence - if MMcontrol should store cookies, capabilities of the heat pump(s) and the state(s) in a file for re-use after process terminates
 */
function MMcontrol(params) {

    var self = this;

    //definition of allowed parameters and default values
    var paramsDef = {
        'url': {
            'required': false,
            'default': 'https://api.melview.net/'
        },
        'username': {
            'required': true
        },
        'password': {
            'required': true
        },
        'userAgent': {
            'required': false
        },
        'log': {
            'required': false
        },
        'minRefresh': {
            'required': false,
            'default': 60
        },
        'tmpDir': {
            'required': false,
            'default': '/tmp'
        },
        'persistence': {
            'required': false,
            'default': true
        }
    };

    //private variables
    self._config = {};
    self._session = {};
    self._capabilities = [];
    self._state = [];

    //validate parameters
    var param;
    for (param in paramsDef) {
        if (paramsDef.hasOwnProperty(param)) {
            if (params[param] === undefined) {
                if (paramsDef[param].required) {
                    throw new TypeError('parameter ' + param + ' is required');
                }
                if (paramsDef[param].default !== undefined) {
                    self._config[param] = paramsDef[param].default;
                }
            } else {
                self._config[param] = params[param];
            }
        }
    }

    //logger
    if (self._config.log !== undefined) {
        try {
            self._log =  self._config.log.child({'module': 'MMcontrol'});
        } catch (exception) {
            throw new TypeError('passed log is not a bunyan logger');
        }
    }

    //JSON client
    self.client = restify.createJsonClient({
        url: self._config.url,
        userAgent: self._config.userAgent
    });

}

/**
 * @function (private) logs a line to the bunyan log (if log is defined)
 * @param {string} message logs a message to bunyan log
 */
MMcontrol.prototype.log = function (message) {

    var self = this;

    if (self._config.log !== undefined) {
        self._log.trace(message);
    }

};

/**
 * @function (private) stores a serialised object in a JSON file
 * @param   {string}   fileName   file name (including full path) to save to
 * @param   {object}   dataObject object to store
 * @param   {function} callback   called with results
 * @returns {object}   - error (if one was encountered)
 */
MMcontrol.prototype.storeJSONFile = function (fileName, dataObject, callback) {

    var self = this;

    self.log("storeJSONFile");

    fs.writeFile(fileName, JSON.stringify(dataObject, null, 0), function (err) {
        if (err) {
            return callback("can't store JSON file (" + fileName + "): " + err);
        }
        return callback();
    });
};

/**
 * @function (private) loads a JSON file from a disks and validates it.
 * @param   {string}   fileName file name (including full path) to load
 * @param   {function} callback called with results
 * @returns {object}   - error (if one was encountered)
 *                     - JSON object
 */
MMcontrol.prototype.loadJSONFile = function (fileName, callback) {

    var self = this;

    self.log("loadJSONFile");

    fs.readFile(fileName, function (err, data) {
        if (err) {
            self.log("can't load JSON file (" + fileName + "): " + err);
            return callback(err);
        }

        var JSONdata = '';
        try {
            JSONdata = JSON.parse(data);
        } catch (exception) {
            return callback(exception);
        }

        return callback(null, JSONdata);
    });
};

/**
 * @function (private) translates numbers returned by the API into human readable strings (based on model file)
 * @param   {number} unitid  sequencial number of the unit to use for translations
 * @param   {string} section section of the file to be used for translations
 * @param   {string} value   value used for mapping
 * @returns {string} mapped value or "uknown (original value)" if a match can't be found
 */
MMcontrol.prototype.getValue = function (unitid, section, value) {

    var self = this;

    if (self._capabilities[unitid].modelData !== undefined) {

        var i;
        for (i in self._capabilities[unitid].modelData[section]) {
            if (self._capabilities[unitid].modelData[section].hasOwnProperty(i)) {
                if (self._capabilities[unitid].modelData[section][i].toString() === value.toString()) {
                    return i;
                }
            }
        }
        return "unknown (" + value + ")";
    }
};

/**
 * @function (private) stores current state (cookies, heat pumps capabilties and states) into a file, if persistence is set
 * @param   {function} callback called with results 
 * @returns {object}   - error (if error was encountered)
 */
MMcontrol.prototype.storeState = function (callback) {

    var self = this;

    self.log("storeState");

    if (self._config.persistence) {

        var state = {
            'session': self._session,
            'capabilities': self._capabilities,
            'state': self._state
        };
        self.storeJSONFile(self._config.tmpDir + '/' + fileNames.state, state, function (err) {
            if (err) {
                return callback(err);
            }
            return callback();
        });
    } else {
        return callback();
    }

};

/**
 * @function (private) extracts session data (only cookies) and stores them in an internal object
 * @param   {object}   headers  set-cookie headers returned in the REST call
 * @param   {function} callback called with results
 * @returns {object}   - error (if one was encountered)
 */
MMcontrol.prototype.storeSessionData = function (headers, callback) {

    var self = this;

    self.log("storeSessionData");

    var i;
    var cookieString, cookieName, cookieValue, cookieList;
    var cookies = {};

    if (headers !== undefined) {
        for (i = 0; i < headers.length; i++) {
            cookieString = headers[i].substr(0, headers[i].indexOf(";"));
            cookieName = cookieString.split("=")[0];
            cookieValue = cookieString.split("=")[1];
            cookies[cookieName] = cookieValue;
        }
        cookieList = '';
        for (cookieName in cookies) {
            if (cookies.hasOwnProperty(cookieName)) {
                cookieList += cookieName + "=" + cookies[cookieName] + "; ";
            }
        }
        self._session.cookieList = cookieList;
        self._session.cookies = cookies;
    }

    self.storeState(function (err) {
        if (err) {
            return callback(err);
        }
        return callback();
    });

};

/**
 * @function (private) loads previous state data from disk
 * @param   {function} callback called with resutls
 * @returns {object} - error (if one was encountered)
 */
MMcontrol.prototype.loadState = function (callback) {

    var self = this;

    self.log("loadState");

    self.loadJSONFile(self._config.tmpDir + '/' + fileNames.state, function (err, state) {
        if (err) {
            return callback(err);
        }

        self._session = state.session;
        self._capabilities = state.capabilities;
        self._state = state.state;
        return callback();
    });

};


/**
 * @function (private) analysis the capabilities of the unit and copies correct properites from the capabilitiesMap into modelData
 * @param   {number}   unitid   sequencial number of the unit to query
 * @param   {function} callback called with results
 * @returns {object}   - error (if one was encountered)
 */
MMcontrol.prototype.parseCapabilities = function (unitid, callback) {

    var self = this;

    self.log("parseCapabilities unitid: " + unitid);

    //loop through the capabilties and add those that matter to the unit definition
    var section, capability;
    var i;

    self._capabilities[unitid].modelData = {};
    for (section in capabilitiesMap) {
        if (capabilitiesMap.hasOwnProperty(section)) {
            self._capabilities[unitid].modelData[section] = {};
            for (capability in capabilitiesMap[section]) {
                if (capabilitiesMap[section].hasOwnProperty(capability)) {
                    if (capabilitiesMapFilter[section] !== undefined && capabilitiesMapFilter[section][capability] !== undefined) {
                        //check if the capability is present and has the correct value
                        if (self._capabilities[unitid][capabilitiesMapFilter[section][capability].capability] !== undefined) {
                            if (self._capabilities[unitid][capabilitiesMapFilter[section][capability].capability].toString() === capabilitiesMapFilter[section][capability].value.toString()) {
                                //check whether to copy the whole subsection structure or just the subsection value
                                if (capabilitiesMapFilter[section][capability].copySubsection !== undefined) {
                                    self._capabilities[unitid].modelData[section][capability] = {};
                                    //subtree to copy
                                    for (i in capabilitiesMap[section][self._capabilities[unitid][capabilitiesMapFilter[section][capability].capability]]) {
                                        if (capabilitiesMap[section][self._capabilities[unitid][capabilitiesMapFilter[section][capability].capability]].hasOwnProperty(i)) {
                                            self._capabilities[unitid].modelData[section][i] = capabilitiesMap[section][self._capabilities[unitid][capabilitiesMapFilter[section][capability].capability]][i];
                                        }
                                    }
                                } else {
                                    //single capability
                                    self._capabilities[unitid].modelData[section][capability] = capabilitiesMap[section][capability];
                                }
                            }
                        }
                    } else {
                        //no filter - copy the capability
                        self._capabilities[unitid].modelData[section][capability] = capabilitiesMap[section][capability];
                    }
                }
            }
        }
    }
    return callback();
};

/**
 * @function (private) calls the MEL API and returns results
 * @param   {string}   action   remote method to call
 * @param   {object}   params   parameters to pass in the POST
 * @param   {function} callback called with results
 * @returns {object}   - error (if one was encountered)
 *                     - object with API response
 */
MMcontrol.prototype.callAPI = function (action, params, callback) {

    var self = this;

    self.log("callAPI - " + action);

    if (APICommands.hasOwnProperty(action)) {

        var options =  {
            path: self._config.url + '/' + APICommands[action].url,
            userAgent: self._config.url,
            headers: {}
        };

        if (self._session.cookieList !== undefined && self._session.cookieList.length > 0) {
            options.headers.Cookie = self._session.cookieList;
        }

        self.client.post(options, params, function (err, cliReq, cliRes, obj) {
            if (err) {
                return callback("API error: " + err);
            }
            if (obj.error !== undefined && obj.error !== "ok") {
                return callback("API error: " + obj.error);
            }

            //ignore the request headers and pacify the linter
            cliReq = Object.keys(cliReq).length;

            self.storeSessionData(cliRes.headers["set-cookie"], function (err) {
                if (err) {
                    return callback(err);
                }
//                self.log("got response:" + JSON.stringify(obj, null, 1));
                return callback(null, obj);
            });
        });
    } else {
        callback("unknown action: " + action);
    }

};

/**
 * @function (private) Calls login API, initialises the capabilities and state
 * @param   {function} callback called with results
 * @returns {object}   - error (if one was encountered)
 */
MMcontrol.prototype.login = function (callback) {

    var self = this;

    self.log("login");

    self.callAPI('login', {user: self._config.username, pass: self._config.password, appversion: appVersion}, function (err, response) {
        if (err) {
            return callback(err);
        }
        if (response.userunits === undefined || response.userunits === 0) {
            //most likely wrong credentials or no units
            return callback("wrong username/password or no heat pumps defined in the app");
        }
        return callback(null, response.userunits);

    });
};


/**
 * @function (private) gets Capabilties of a unit using the API
 * @param   {number}   unitid   sequencial number of the unit to query (derived from userunits returned by login)
 * @param   {function} callback called with results
 * @returns {object}   - error (if one was encoutnred)
 *                     - object with capabilities (raw format)
 */
MMcontrol.prototype.callUnitCapabilities = function (unitid, callback) {

    var self = this;

    self.log("callUnitCapabilites unitid:" + unitid);

    self.callAPI('unitcapabilities', {unitid: unitid}, function (err, unitCapabilities) {
        if (err) {
            return callback(err);
        }
        return callback(null, unitCapabilities);
    });
};

/**
 * @function (private) queries current state of the heat pump unit
 * @param   {number}   unitid   sequencial number of the unit to query (derived from userunits returned by login)
 * @param   {function} callback called with results
 * @returns {object}   - error (if one was encountered)
 *                     - object with state of the unit (raw format)
 */
MMcontrol.prototype.callUnitState = function (unitid, callback) {

    var self = this;

    self.log("callUnitState unitid:" + unitid);

    self.callAPI('unitcommand', {unitid: self._capabilities[unitid].id, v: 2}, function (err, unitState) {
        if (err) {
            return callback(err);
        }
        self._state[unitid] = unitState;
        self._state[unitid].timestamp = (new Date()).getTime();
        return callback(null, unitState);
    });
};

/**
 * @function (private) initialises internal storage objects (capabilities and state) fills it with information from the API
 * @param   {number}   userunits nubmer of units returned by the 'login' command (total number of heat pump units registered)
 * @param   {function} callback  called with results
 * @returns {object}   - error (if one was encountered)
 */
MMcontrol.prototype.initialise = function (userunits, callback) {

    var self = this;

    self.log("initialise");

    var i;
    for (i = 0; i < userunits; i++) {
        self._capabilities[i] = {};
        self._capabilities[i].unitid = i;
        self._state[i] = {};
        self._state[i].unitid = i;
    }
    async.series([
        //get capabilities of each unit
        function (callback) {
            async.each(self._capabilities,
                function (id, callback) {
                    self.log("getting capabilties for: " + id.unitid);
                    self.callUnitCapabilities(id.unitid, function (err, unitCapabilties) {
                        if (err) {
                            return callback(err);
                        }
                        for (i = 0; i < knownCapabilities.length; i++) {
                            if (unitCapabilties[knownCapabilities[i]] !== undefined) {
                                self._capabilities[id.unitid][knownCapabilities[i]] = unitCapabilties[knownCapabilities[i]];
                            }
                        }
                        return callback();
                    });
                },
                function (err) {
                    if (err) {
                        return callback(err);
                    }
                    return callback();
                });
        },
        //get current state of each unit
        function (callback) {
            async.each(self._capabilities,
                function (id, callback) {
                    self.log("getting state for: " + id.unitid);
                    self.callUnitState(id.unitid, function (err) {
                        if (err) {
                            return callback(err);
                        }
                        return callback();
                    });
                },
                function (err) {
                    if (err) {
                        return callback(err);
                    }
                    return callback();
                });
        },
        //get load the mapping file (model) of each unit
        function (callback) {
            async.each(self._capabilities,
                function (id, callback) {
                    self.log("getting model data for " + id.unitid);
                    self.parseCapabilities(id.unitid, function (err) {
                        if (err) {
                            return callback(err);
                        }
                        return callback();
                    });
                },
                function (err) {
                    if (err) {
                        return callback(err);
                    }
                    return callback();
                });
        }],
        function (err) {
            if (err) {
                return callback(err);
            }
            self.storeState(function (err) {
                if (err) {
                    return callback(err);
                }
                return callback();
            });
        });
};

/**
 * @function Establishes session details either using previously stored session or by building a new one
 * @param   {boolean}  reuse    Should a previously stored state be reused
 * @param   {function} callback called with results
 * @returns {object}   - error (if one was encountered)
 */
MMcontrol.prototype.connect = function (reuse, callback) {

    var self = this;

    self.log("connect");

    if (self._config.persistence && reuse) {
        self.loadState(function (err) {
            if (err) {
                //couldn't load the state details - ignore and build new ones
                self.login(function (err, userunits) {
                    if (err) {
                        return callback(err);
                    }
                    self.initialise(userunits, function (err) {
                        if (err) {
                            return callback(err);
                        }
                        return callback();
                    });
                });
            } else {
                return callback();
            }
        });
    } else {
        self.login(function (err, userunits) {
            if (err) {
                return callback(err);
            }
            self.initialise(userunits, function (err) {
                if (err) {
                    return callback(err);
                }
                return callback();
            });
        });
    }
};

/**
 * @function Returns an array with unit names
 * @param   {function} callback called with results
 * @returns {object}   - error (if one was encountered)
 *                     - array of units:
 *                      - name of the unit
 */
MMcontrol.prototype.getUnitList = function (callback) {

    var self = this;

    self.log("getUnitList");

    var units = [];
    var i;
    for (i = 0; i < self._capabilities.length; i++) {
        units[i] = self._capabilities[i].unitname;
    }
    return callback(null, units);
};

/**
 * @function Returns an object with capabilities enabled for the unit
 * @param   {number}   unitid   sequencial number of the unit to query
 * @param   {function} callback called with results
 * @returns {object}   - error (if one was encountered)
 *                     - capabilties object:
 *                       - action - allowed actions
 *                       - mode - allowed modes
 *                       - power - allowed power states
 *                       - fan - allowed fan speeds
 *                       - airDirH - allowed horizontal direction settings
 *                       - airDirV - allowed vertial direction settings
 */
MMcontrol.prototype.getCapabilities = function (unitid, callback) {

    var self = this;

    self.log("getCapabilities");

    var capabilities = {};
    var i, j;
    for (i in self._capabilities[unitid].modelData) {
        if (self._capabilities[unitid].modelData.hasOwnProperty(i)) {
            capabilities[i] = [];
            for (j in self._capabilities[unitid].modelData[i]) {
                if (self._capabilities[unitid].modelData[i].hasOwnProperty(j)) {
                    capabilities[i].push(j);
                }
            }
        }
    }
    return callback(null, capabilities);
};

/**
 * @function returns the current state of the unit. Either queries remote API or returns cached data (depending if minRefresh has xpired or not)
 * @param   {number}   unitid   sequencial number of the unit to query
 * @param   {function} callback called with results
 * @returns {object}   - error (if one was encountered)
 *                              - state object: 
 *                              - mode - ('auto', 'cool', 'heat', 'dry', 'fan' or 'unknown')
 *                              - automode - ('cool' or 'heat') - only of interest if mode returns 'auto'
 *                              - fan - current fan speed (string)
 *                              - power - ('on' or 'off')
 *                              - setTemperature - target temperature (float)
 *                              - roomTemperature - current temperature (float)
 */
MMcontrol.prototype.getCurrentState = function (unitid, callback) {

    var self = this;

    self.log("getCurrentState (u:" + unitid + ")");

    async.series([
        function (callback) {
            //check if the map of capabilities is loaded for the unit
            if (self._capabilities[unitid].modelData === undefined) {
                self.loadModel(unitid, function (err) {
                    if (err) {
                        return callback(err);
                    }
                    return callback();
                });
            } else {
                return callback();
            }
        },
        function (callback) {
            //check if we should refresh the data using API
            if (self._state[unitid].timestamp === undefined || ((new Date()).getTime() - self._state[unitid].timestamp) > self._config.minRefresh * 1000) {
                self.callUnitState(unitid, function (err) {
                    if (err) {
                        return callback(err);
                    }
                    self.storeState(function (err) {
                        if (err) {
                            return callback(err);
                        }
                        return callback();
                    });
                });
            } else {
                return callback();
            }
        },
        function (callback) {
            //parse the current state data into a unifited format
            var currentState = {
                'mode': self.getValue(unitid, 'mode', self._state[unitid].setmode),
                'automode': self.getValue(unitid, 'mode', self._state[unitid].setmode) === 'auto' ? self.getValue(unitid, 'mode', self._state[unitid].automode) : '',
                'standby': self._state[unitid].standby === "1" ? "on" : "off",
                'fanSpeed': self.getValue(unitid, 'fan', self._state[unitid].setfan),
                'power': self.getValue(unitid, 'power', self._state[unitid].power),
                'setTemperature': parseFloat(self._state[unitid].settemp),
                'roomTemperature': parseFloat(self._state[unitid].roomtemp),
                'airDirV': self._capabilities[unitid].modelData.action.airDirV !== undefined ? self.getValue(unitid, 'airDirV', self._state[unitid].airdir) : '',
                'airDirH': self._capabilities[unitid].modelData.action.airDirH !== undefined ? self.getValue(unitid, 'airDirH', self._state[unitid].airdirh) : ''
            };
            return callback(null, currentState);
        }
    ],
        function (err, results) {
            if (err) {
                return callback(err);
            }
            return callback(null, results.pop());
        });
};

/**
 * @function returns the current state of the unit as returned by the API. Either queries remote API or returns cached data (depending if minRefresh has expired or not)
 * @param   {number}   unitid   sequencial number of the unit to query
 * @param   {function} callback called with results
 * @returns {object}   - error (if one was encountered)
 *                     - state object - all values are strings
 */
MMcontrol.prototype.getCurrentStateRaw = function (unitid, callback) {

    var self = this;

    self.log("getCurrentStateRaw (u:" + unitid + ")");

    if (self._state[unitid].timestamp === undefined || ((new Date()).getTime() - self._state[unitid].timestamp) > self._config.minRefresh * 1000) {
        self.callUnitState(unitid, function (err) {
            if (err) {
                return callback(err);
            }
            self.storeState(function (err) {
                if (err) {
                    return callback(err);
                }
                return callback(null, self._state[unitid]);
            });
        });
    } else {
        return callback(null, self._state[unitid]);
    }
};


/**
 * @function (private) calls a command using API, on success updates the state of the unit
 * @param   {number}   unitid   sequencial number of the unit to send the command to
 * @param   {string}   command  command to send (command is send 'as is')
 * @param   {function} callback called with results
 * @returns {object}   - error (if one was encountered)
 */
MMcontrol.prototype.sendCommand = function (unitid, command, callback) {

    var self = this;

    self.log("sendCommand (u:" + unitid + ") command: " + command);

    self.callAPI('unitcommand', {unitid: self._capabilities[unitid].id, v: 2, commands: command}, function (err, unitState) {
        if (err) {
            return callback(err);
        }
        self._state[unitid] = unitState;
        self._state[unitid].timestamp = (new Date()).getTime();
        return callback();
    });
//    return callback();
};

/**
 * @function sets the power state of the unit
 * @param   {number}   unitid   sequencial number of the unit to send the command to
 * @param   {string}   state    the power state to set (on, off)
 * @param   {function} callback called with results
 * @returns {object}   - error (if one was encountered)
 */
MMcontrol.prototype.setPower = function (unitid, state, callback) {

    var self = this;

    self.log("setPower (u:" + unitid + ") to " + state);
    if (self._capabilities[unitid].modelData.action.power !== undefined) {
        if (self._capabilities[unitid].modelData.power[state] !== undefined) {
            self.sendCommand(unitid, self._capabilities[unitid].modelData.action.power + self._capabilities[unitid].modelData.power[state], function (err) {
                if (err) {
                    return callback(err);
                }
                return callback();
            });
        } else {
            return callback("uknown power state: " + state);
        }
    } else {
        return callback("model file doesn't have a action for power commands");
    }
};

/**
 * @function sets the target temperature for the unit (corrected to fit within the mode range)
 * @param   {number}   unitid      sequencial number of the unit to send the command to
 * @param   {number}   temperature temperature to set  (float, but only .0 and .5 are allowed)
 * @param   {function} callback    called with results
 * @returns {object}   - error (if one was encountered)
 */
MMcontrol.prototype.setTemperature = function (unitid, temperature, callback) {

    var self = this;

    self.log("setTemperature (u:" + unitid + ") to " + temperature);

    temperature = parseFloat(temperature);

    if (!isNaN(temperature)) {
        //check if current mode has temperature limits and change temperature to match
        if (self._capabilities[unitid].max[self._state[unitid].setmode] !== undefined) {
            if (temperature < self._capabilities[unitid].max[self._state[unitid].setmode].min) {
                temperature = self._capabilities[unitid].max[self._state[unitid].setmode].min;
            }
            if (temperature > self._capabilities[unitid].max[self._state[unitid].setmode].max) {
                temperature = self._capabilities[unitid].max[self._state[unitid].setmode].max;
            }

            self.sendCommand(unitid, self._capabilities[unitid].modelData.action.temperature + temperature, function (err) {
                if (err) {
                    return callback(err);
                }
                return callback();
            });
        } else {
            return callback();
        }
    } else {
        return callback("wrong temperature: " + temperature);
    }
};

/**
 * @function sets the mode of operation of the unit (and adjusts the temperature to be within valid range for the mode)
 * @param   {number}   unitid   sequencial number of the unit to send the command to
 * @param   {string}   mode     the mode to set (auto, dry, cool, heat, fan)
 * @param   {function} callback called with results
 * @returns {object}   - error (if one was encountered)
 */
MMcontrol.prototype.setMode = function (unitid, mode, callback) {

    var self = this;

    self.log("setMode (u:" + unitid + ") to " + mode);

    //make sure the unit has the requested mode
    if (self._capabilities[unitid].modelData.action.mode !== undefined) {
        if (self._capabilities[unitid].modelData.mode[mode] !== undefined) {
            //check if the current temperature is within the range for the new mode and adjust accoridingly
            var temperature = self._state[unitid].settemp;
            if (self._capabilities[unitid].max[self._capabilities[unitid].modelData.mode[mode]] !== undefined) {
                if (temperature < self._capabilities[unitid].max[self._capabilities[unitid].modelData.mode[mode]].min) {
                    temperature = self._capabilities[unitid].max[self._capabilities[unitid].modelData.mode[mode]].min;
                }
                if (temperature > self._capabilities[unitid].max[self._capabilities[unitid].modelData.mode[mode]].max) {
                    temperature = self._capabilities[unitid].max[self._capabilities[unitid].modelData.mode[mode]].max;
                }
            }
            if (temperature.toString() !== self._state[unitid].settemp.toString()) {
                self.setTemperature(unitid, temperature, function (err) {
                    if (err) {
                        return callback(err);
                    }
                    self.sendCommand(unitid, self._capabilities[unitid].modelData.action.mode + self._capabilities[unitid].modelData.mode[mode], function (err) {
                        if (err) {
                            return callback(err);
                        }
                        return callback();
                    });
                });
            } else {
                self.sendCommand(unitid, self._capabilities[unitid].modelData.action.mode + self._capabilities[unitid].modelData.mode[mode], function (err) {
                    if (err) {
                        return callback(err);
                    }
                    return callback();
                });
            }
        } else {
            return callback("uknown mode: " + mode);
        }
    } else {
        return callback("no action to change mode");
    }
};

/**
 * @function sets the fan speed of the unit
 * @param   {number}   unitid   sequencial number of the unit to send the command to
 * @param   {string}   fanSpeed fan speed (allowed values are defined in the model file)
 * @param   {function} callback called with results
 * @returns {object}   - error (if one was encountered)
 */
MMcontrol.prototype.setFanSpeed = function (unitid, fanSpeed, callback) {

    var self = this;

    self.log("setFanSpeed (u:" + unitid + ") to " + fanSpeed);

    fanSpeed = fanSpeed.toString();

    if (self._capabilities[unitid].modelData.action.fan !== undefined) {
        if (self._capabilities[unitid].modelData.fan[fanSpeed] !== undefined) {
            self.sendCommand(unitid, self._capabilities[unitid].modelData.action.fan + self._capabilities[unitid].modelData.fan[fanSpeed], function (err) {
                if (err) {
                    return callback(err);
                }
                return callback();
            });
        } else {
            return callback("unit doesn't support fan speed: " + fanSpeed);
        }
    } else {
        return callback("unit doesn't support changing the fan speed");
    }
};

/**
 * @function sets the vertical air direction
 * @param   {number}   unitid   sequencial number of the unit to send the command to
 * @param   {string}   dir requested direction
 * @param   {function} callback called with results
 * @returns {object}   - error (if one was encountered)
 */
MMcontrol.prototype.setAirDirV = function (unitid, dir, callback) {

    var self = this;

    self.log("setAirDirV (u:" + unitid + ") to " + dir);

    dir = dir.toString();

    if (self._capabilities[unitid].modelData.action.airDirV !== undefined) {
        if (self._capabilities[unitid].modelData.airDirV[dir] !== undefined) {
            self.sendCommand(unitid, self._capabilities[unitid].modelData.action.airDirV + self._capabilities[unitid].modelData.airDirV[dir], function (err) {
                if (err) {
                    return callback(err);
                }
                return callback();
            });
        } else {
            return callback("unit doesn't support vertical air direction: " + dir);
        }
    } else {
        return callback("unit doesn't support changing the vertical air direction");
    }
};

/**
 * @function sets the horizontal air direction
 * @param   {number}   unitid   sequencial number of the unit to send the command to
 * @param   {string}   dir requested direction
 * @param   {function} callback called with results
 * @returns {object}   - error (if one was encountered)
 */
MMcontrol.prototype.setAirDirH = function (unitid, dir, callback) {

    var self = this;

    self.log("setAirDirH (u:" + unitid + ") to " + dir);

    dir = dir.toString();

    if (self._capabilities[unitid].modelData.action.airDirH !== undefined) {
        if (self._capabilities[unitid].modelData.airDirH[dir] !== undefined) {
            self.sendCommand(unitid, self._capabilities[unitid].modelData.action.airDirH + self._capabilities[unitid].modelData.airDirH[dir], function (err) {
                if (err) {
                    return callback(err);
                }
                return callback();
            });
        } else {
            return callback("unit doesn't support horizontal air direction: " + dir);
        }
    } else {
        return callback("unit doesn't support changing the horizonal air direction");
    }
};

//exports
module.exports = MMcontrol;
