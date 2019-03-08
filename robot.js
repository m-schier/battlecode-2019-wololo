/**
 *  Battlecode 2019 submission, Team Wololo, AI program for turn based strategy game.
 *  Copyright (C) 2019 Paul Hindricks, Maximilian Schier and Niclas Wüstenbecker
 *
 *  This program is free software: you can redistribute it and/or modify
 *  it under the terms of the GNU General Public License as published by
 *  the Free Software Foundation, either version 3 of the License, or
 *  (at your option) any later version.
 *
 *  This program is distributed in the hope that it will be useful,
 *  but WITHOUT ANY WARRANTY; without even the implied warranty of
 *  MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 *  GNU General Public License for more details.
 *
 *  You should have received a copy of the GNU General Public License
 *  along with this program.  If not, see <https://www.gnu.org/licenses/>.
 */

"use strict"
import {BCAbstractRobot, SPECS} from 'battlecode';
import {PriorityQueue} from 'PriorityQueue.js';
import { WorldKnowledge } from 'WorldKnowledge.js';
import { Lattice } from 'Lattice.js';
import * as Random from 'Random.js';
import {Strategy} from 'Strategy.js';

// Indicates which mode we are running, set to true before uploading
const COMPETITION_MODE = true;
const NO_TIMING = true;

const NAV = {
    "ECONOMIC": 0,
    "FASTEST": 1
};

const RADIO_PRIO = {
    HOLD: 0,
    SCOUT: 10,
    TARGET: 20,
    CHARGE: 25,
    REPULSE: 30
}

// Castle talk priorities
const CASTLETALK_PRIO = {
    POSITION: 0,
    ALERT: 70,
    CASTLE_DESTROYED: 91,
    DBG_CLOCK_REQEUST: 99,
    IDENT: 100 // Use IDENT priority for sending first castle position update too
};

const CASTLE_STATE = {
    NEGOTIATE_MASTER: 0,
    RUSH: 1,
    HOLD: 2,
    AWAIT_RUSH: 3
};

const MILITARY_STATE = {
    TARGET_MIRROR: 0,
    HOLD: 1,
    TARGET_TARGETS: 2,
    HOME: 3,
    CHARGE: 4
};

const WORKER_STATE = {
    MINE: 0,
    CONSTRUCT: 1,
    DROPOFF: 2,
    SCOUT: 3
};

// Constants
const STRUCTURE_MINING_INFLUENCE = 4;

// The minimum chebyshev distance between a church and its closest structure
// Lower than the mining influence to allow for constructing good churches
// if a worker builds an emergency church
const MINIMUM_CHURCH_DISTANCE = 3;

// Charge duration in turns
const CHARGE_DURATION = 6;

// Strategies

const STRATEGY_OPTIONAL_TANK_RUSH = {
    RUSH_MAX_CASTLES: 3, 
    RUSH_ORDER: [SPECS.PREACHER, SPECS.PREACHER, SPECS.PREACHER],
    ALLOW_OFFENSIVE_EXPAND: true,
    OFFENSIVE_EXPAND_MULTIPLIER: 15,
    IDLE_MILITARY_WEIGHTS: [0.5, 1, 1],
    ATTACK_WHEN: 100
}

const STRATEGY_BOOM_RED = {
    RUSH_MAX_CASTLES: 0,
    RUSH_ORDER: [SPECS.PREACHER, SPECS.PREACHER, SPECS.PREACHER],
    ALLOW_OFFENSIVE_EXPAND: true,
    ALLOW_LARGE_SCALE_ATTACK: true,
    MINIMUM_EMERGENCY_CHURCH_SCORE: 2,
    PLACE_CHURCH_FORWARD: false,
    ESCORT_TARGET_MIRROR: true,
    LATTICE_INTERWEAVE: SPECS.PREACHER,
    ALLOW_MILITAY_CHARGE: true,
    MAX_ATTACK_TURN: 500,
    IDLE_MILITARY_WEIGHTS: null // Auto determine
}

const STRATEGY_BOOM_BLUE = {
    RUSH_MAX_CASTLES: 0,
    ALLOW_OFFENSIVE_EXPAND: true,
    ALLOW_LARGE_SCALE_ATTACK: true,
    MINIMUM_EMERGENCY_CHURCH_SCORE: 2,
    PLACE_CHURCH_FORWARD: true,
    ESCORT_TARGET_MIRROR: true,
    // INITIALLY_CONSIDER_DANGEROUS: -0.5, // Agressiveness initially considered dangerous
    RUSH_FIRST_EXPAND: true,
    EXPAND_QUEUE: [SPECS.CRUSADER, SPECS.PROPHET],
    BASE_KARB_FLOAT: 30,
    MIRROR_FROM_CHURCH_EXPAND: true,
    ALLOW_RAPID_SAFE_EXPAND: true,
    LATTICE_INTERWEAVE: SPECS.PREACHER,
    LATTICE_DENSE: true,
    ALLOW_MIRROR_CHARGE: false,
    MAX_ATTACK_TURN: 500,
    ALLOW_MILITAY_CHARGE: true, // Military may charge on own authority
    IDLE_MILITARY_WEIGHTS: null // Auto determine
}

const STRATEGY_BOOM_DEFENSIVE = {
    RUSH_MAX_CASTLES: 0,
    IDLE_MILITARY_WEIGHTS: null // Auto determine
}

// ---------------------------------------------------
// Global helper functions
// ---------------------------------------------------

function euclidean(x, y) {
    return Math.sqrt(x*x+y*y);
}

/**
 * Calculate the grid tile size for the given map size
 * @param {number} mapSize 
 */
function calculateTileSize(mapSize) {
    // Important to round up, i.e. tiling a 3x3 map into 2x2 tiles
    // must return a tile size of 2, not 1
    return Math.ceil(mapSize / 8);
}

/**
 * Calculate the Chebyshev distance, which is an accuracte distance metric
 * for most economic travel (chess king move)
 * @param {number} x1 First x coordinate
 * @param {number} y1 First y coordinate
 * @param {number} x2 Second x coordinate
 * @param {number} y2 Second y coordinate
 */
function chebyshevDistance(x1, y1, x2, y2) {
    return Math.max(Math.abs(x1 - x2), Math.abs(y1 - y2));
}

function euclideanDistance(x1, y1, x2, y2) {
    return Math.sqrt(squaredEuclideanDistance(x1, y1, x2, y2));
}

/**
 * Return the Schier distance between the two coordinates. This distance
 * meassure is similar to the Chebyshev distance, but weights diagonal movement
 * differently as units cannot travel as far diagonally at fastest speed.
 * @param {number} x1 First x coordinate
 * @param {number} y1 First y coordinate
 * @param {number} x2 Second x coordinate
 * @param {number} y2 Second y coordinate
 */
function schierDistance(x1, y1, x2, y2) {
    const xdiff = Math.abs(x1 - x2);
    const ydiff = Math.abs(y1 - y2);

    const max = Math.max(xdiff, ydiff);
    const min = Math.min(xdiff, ydiff);

    const diag = max - min;
    const straight = min;

    return diag * (3 / 2) + straight;
}

function squaredEuclideanDistance(x1, y1, x2, y2) {
    const dx = x1 - x2;
    const dy = y1 - y2;

    return dx * dx + dy * dy;
}

/**
 * Generate castle talk message (single or multi part)
 * @param {*} message_type string with type. Possible types: "position1", "position2", "event", "important"
 * @param {*} message_content (x,y) for position messages, unit for ident messages, rest is not implemented yet..
 * @param {*} map_size this.map.length, required if position message is sent
 */
function castleTalkMessage(message_type, message_content, map_size = -1) {
    // 00 -- Event
    // 00 000 001-110 IDENT
    // 00 000 111     CLOCK_REQUEST (DEBUG)
    // 00 101 000-111 ALERT
    // 10 *** *** -- Position
    const tileSize = calculateTileSize(map_size);

    var message = 0
    if (message_type === "position") {
        // rough grid 8x8
        // message_content is position (x,y)
        const xGrid = Math.floor(message_content[0] / tileSize);
        const yGrid = Math.floor(message_content[1] / tileSize);
        return [
            encodeBits([2, xGrid, yGrid], [2, 3, 3]),
            encodeBits([2, message_content[0] % tileSize, message_content[1] % tileSize], [2, 3, 3])
        ];
    } else if (message_type === "ident") {
        return encodeBits([0 /*event*/, 0 /*ident*/, message_content + 1 /*type*/], [2, 3, 3]);
    } else if (message_type === "dbgClock") {
        return encodeBits([0 /*event*/, 7 /*clock*/], [2, 6]);
    } else if (message_type === "alert") {
        return encodeBits([0 /*event*/, 5 /*alert*/, message_content], [2, 3, 3]);
    } else if (message_type === "important") {
        // header 01
        message += 64
        // saw church
    } else {
        throw "Unknown message type"
    }
    return message
}

/**
 * Decrypts message int and returns type and content
 * @param {*} message int message received
 * @param {*} map_size this.map.length, required, because message could be position
 */
function decryptCastleTalk(message) {
    const [header, body] = decodeBits(message, [2, 6]);

    if (header === 2) {
        return {type: "position", content: decodeBits(body, [3, 3])};
    } else if (header === 1) {
        // header 01 => important message
        return {type: "important", content: null}
    } else {
        // header 00 => event message
        // Content 1-6 are Ident events
        if (1 <= body && body <= 6) {
            return {type: "ident", unit: body - 1};
        } else if (body === 7) {
            return {type:"dbgClock"};
        } else if (40 <= body && body <= 47) {
            return {type:"alert", direction: body - 40};
        } else {
            return {type: "event", content: null};
        }
    }
}

function encodeRadio(obj) {
    // Radio coding:
    // 000 TARGET
    //     C XXXXXX YYYYYY clearExisting x y
    // 001 EVENT
    //     0000000000000 Hold
    //     0000000000001 Repulse
    //     001____camddd Charge Crusader, Archer, Mage, Direction
    // 010 MINE
    //     C XXXXXX YYYYYY construct x y
    // 011 SCOUT
    //     U CC KK AA TT DDDD update churches knights archers tanks direction
    // 100 TARGET ON CONSTRUCT
    //     M XXXXXX YYYYYY alsoMirror x y

    if (obj.type === "hold") {
        return encodeBits([1, 0], [3, 13]);
    } else if (obj.type === "repulse") {
        return encodeBits([1, 1], [3, 13]);
    } else if (obj.type === "charge") {
        const crusader = obj.crusader ? 1 : 0;
        const archer = obj.archer ? 1 : 0;
        const mage = obj.mage ? 1 : 0;
        return encodeBits([1, 1, 0, crusader, archer, mage, obj.direction], [3, 3, 4, 1, 1, 1, 3]);
    } else if (obj.type === "target") {
        let clearExisting = obj.clearExisting === false ? 0 : 1;
        return encodeBits([0, clearExisting, obj.x, obj.y], [3, 1, 6, 6]);
    } else if (obj.type === "mine") {
        const construct = obj.construct ? 1 : 0;
        return encodeBits([2, construct, obj.x, obj.y], [3, 1, 6, 6]);
    } else if (obj.type === "scout") {
        const update = obj.update === false ? 0 : 1;
        return encodeBits([3, update, obj.churches, obj.crusaders, obj.prophets, obj.preachers, obj.direction], [3, 1, 2, 2, 2, 2, 4])
    } else if (obj.type === "targetOnConstruct") {
        const alsoMirror = obj.alsoMirror ? 1 : 0;
        return encodeBits([4, alsoMirror, obj.x, obj.y], [3, 1, 6, 6]);
    } else {
        throw Error("Radio message type not understood");
    }
}

/**
 * Decodes radio message int and returns type and content
 * @param {*} message int message received
 */
function decodeRadio(message) {
    const [baseHeader, baseContent] = decodeBits(message, [3, 13]);

    if (baseHeader === 0) {
        const [clearExisting, x, y] = decodeBits(baseContent, [1, 6, 6]);
        return {type: "target", clearExisting: !!clearExisting, x: x, y: y};
    } else if (baseHeader === 1) {
        const [eventType, eventPayload] = decodeBits(baseContent, [3, 10]);
        if (eventType === 0 /* Flag event */) {
            if (eventPayload === 0) {
                return {type: "hold"};
            } else if (eventPayload === 1) {
                return {type: "repulse"};
            }
        } else if (eventType === 1) {
            const [_, c, a, m, d] = decodeBits(eventPayload, [4, 1, 1, 1, 3]);
            return {type: "charge", crusader: !!c, archer: !!a, mage: !!m, direction: d};
        }
    } else if (baseHeader === 2) {
        const [construct, x, y] = decodeBits(baseContent, [1, 6, 6]);
        return {type: "mine", x: x, y: y, construct: !!construct};
    } else if (baseHeader === 4) {
        const [m, x, y] = decodeBits(baseContent, [1, 6, 6]);
        return {type: "targetOnConstruct", x: x, y: y, alsoMirror: !!m};
    }

    this.log("Failed to decode radio transmission: " + message);

    return {};
}

/**
 * Split the given message according to the specified bit pattern,
 * where the last entry of the pattern array specifies the number of bits
 * of the last message segment (towards LSB), earlier entries specifying
 * segments towards MSB. Returns all decoded segments in array in same order.
 * Discards unused bits if message too long. (Due to the algorithm described
 * above, naturally bits towards MSB are discarded).
 * Example: The pattern [1, 2, 3] will split the message 010111b into the parts
 * [0b, 10b, 111b].
 * @param {number} msg Message to decode
 * @param {array} pattern Pattern array as described above
 */
function decodeBits(msg, pattern) {
    let result = new Array(pattern.length);

    for (let i = pattern.length - 1; i >= 0; --i) {
        // filterPattern = 2^n - 1 = (2 << (n - 1)) - 1 = (1 << n) - 1
        result[i] = msg & ((1 << pattern[i]) - 1);
        msg = msg >> pattern[i];
    }

    return result;
}

/**
 * Encode numerical contents with specified pattern to bit message
 * @param {array} contents Contents array, must consist only of non-negative safe integers.
 * @param {array} pattern Pattern array, for more information see decodeBits. Dimensions must agree.
 */
function encodeBits(contents, pattern) {
    if (contents.length !== pattern.length) {
        throw Error("Content and message encoding pattern lengths mismatch");
    }

    let msg = 0;

    for (let i = 0; i < pattern.length; ++i) {
        const c = contents[i];
        const p = pattern[i];
        if (!Number.isSafeInteger(c)) throw Error("Not a safe integer value: " + c);
        if (c < 0) throw Error("Cannot (currently) encode negative values: " + c);
        if (c >= (1 << p)) throw Error("Value " + c + " exceeeds allowed maximum for pattern length " + p);
        msg = msg << p | c;
    }

    return msg;
}

function quantifyDirection(dx, dy) {
    // atan2 returns angle [-PI, PI]
    const angle = Math.atan2(dy, dx);
    
    return Number.positiveMod(Math.round(angle / (2 * Math.PI) * 8), 8);
}

function vectorFromQuantifiedDirection(d, scale) {
    scale = scale || 1;
    const angle = d / 8 * Math.PI * 2;
    return [Math.round(Math.cos(angle) * scale), Math.round(Math.sin(angle) * scale)];
}

/**
 * Check two n-dimensional numeric arrays for equality. Both arrays may have any shape, but
 * most only contain numbers, null and undefined as leaf elements.
 * @param {array} a First array
 * @param {array} b Second array
 */
function equalsnd(a, b) {
    // Fail if lengths different
    if (a.length !== b.length) return false;

    // Succeed immediately if both empty
    if (a.length === 0) return true;

    // If array elements differ in depth, fail
    if (Array.isArray(a[0]) !== Array.isArray(b[0])) return false;

    // If elements are also arrays
    if (Array.isArray(a[0])) {
        // Iterate elements and compare recursively, fail fast if mismatch
        for (let i = 0; i < a.length; ++i) {
            if (!equalsnd(a[i], b[i])) return false;
        }
    } else {
        // Else just iterate elements and compare with equality operator
        for (let i = 0; i < a.length; ++i) {
            if (a[i] !== b[i]) return false;
        }
    }

    return true;
}

/**
 * Masks a 2d array
 * @param {*} array the data array to be masked 
 * @param {*} mask  boolean array of the same size as array
 * @param {*} value value of all cells that are not in mask
 */
function maskArray(array, mask, value) {
    
    let out = Array.filled2D(array.length, array[0].length, value);

    for (let i = 0; i < array.length; ++i) {
        for (let j = 0; j < array[0].length; ++j) {
            if (mask[i][j] === true) out[i][j] = array[i][j];
        }
    }
    return out;
}


/**
 * Remove duplicates from the specified coordinate list in form [[x, y], ...].
 * Modifies the existing array, but returns a new filtered array
 * @param {array} a Array of coordinates
 */
function coordinatesRemoveDoubles(a) {
    // First sort by first coordinate, then second
    a.sort((x, y) => x[0] - y[0] || x[1] - y[1]);

    let result = [];

    // Now filter for adjacent doubles
    for (let i = 0; i < a.length; ++i) {
        if (i === 0 || (a[i][0] !== a[i - 1][0] || a[i][1] !== a[i - 1][1])) {
            result.push(a[i]);
        }
    }

    return result;
}

/**
 * Apply 2d filter kernel to 2d array with zero padding and stride of kernel size
 * @param {*} array
 * @param {*} kernel 
 */
function apply2dFilterKernel(array, kernel, stride) {
    const rows = array.length
    const cols = array[0].length

    const kRows = kernel.length
    const kCols = kernel[0].length

    if (rows === 0 || cols === 0 || rows < kRows || cols < kCols) {
        throw Error("Invalid configuration! Array is " + rows + "x" + cols + " while kernel is" + kRows + "x" + kCols)
    }

    let out = Array.filled2D(Math.ceil(rows / kRows), Math.ceil(cols / kCols), 0)
    
    for (let i = 0; i < rows; i+=kRows) {                    //iterate over image
        for (let j = 0; j < cols; j+=kCols) {
            let weighted_sum = 0
            for (let k_i = 0; k_i < kRows; ++k_i) {          // iterate over kernel
                for (let k_j = 0; k_j < kCols; ++k_j) {
                    if (i + k_i >= rows || j + k_j >= cols) continue
                    let data = array[i + k_i][j + k_j]
                    let coeff = kernel[k_i][k_j]
                    weighted_sum += data*coeff
                }
            }
            out[Math.ceil(i / kRows)][Math.ceil(j / kCols)] = weighted_sum
        }
    }
    return out
}

class MyRobot extends BCAbstractRobot {
    // -----------------------------------------------
    // Helper functions 
    // -----------------------------------------------

    /**
     * Check whether the ressources are available to build the specified unit, optional specify additional
     * spillover ressources to consider success.
     * @param {number} unit Unit type id
     * @param {number} extraKarbonite Additional karbonite required after building to consider success
     * @param {number} extraFuel Additional fuel required after building to consider success
     */
    canBuild(unit, extraKarbonite, extraFuel) {
        extraKarbonite = extraKarbonite || 0;
        extraFuel = extraFuel || 0;

        const specs = SPECS.UNITS[unit];

        if (specs.CONSTRUCTION_KARBONITE === null) throw Error("Unit " + this.formatUnit(unit) + " is not buildable");

        return this.karbonite >= specs.CONSTRUCTION_KARBONITE + extraKarbonite && this.fuel >= specs.CONSTRUCTION_FUEL + extraFuel;
    }

    countVision(team) {
        if (team == null) throw Error("Need team");

        let result = new Array(6).fill(0);

        let visible = this.getTruelyVisibleRobots();

        for (let i = 0; i < visible.length; ++i) {
            const r = visible[i];

            if (r.team !== team) continue;

            result[r.unit]++;
        }

        return result;
    }

    /**
     * Overlay terrain passable map with all currently perceived (vision or radio triangulation)
     * units. Cached on turn basis for efficiency.
     */
    generateTrueVisionPassableMap() {
        if (this._util_tv_cache_turn !== this.me.turn) {
            let tvmap = Array.copied2D(this.getPassableMap());
            
            const robots = this.getVisibleRobots();

            for (let i = 0; i < robots.length; ++i) {
                const r = robots[i];

                if (this.isVisible(r) || this.isRadioing(r)) {
                    tvmap[r.y][r.x] = false;
                }
            }

            this._util_tv_cache_map = tvmap;
            this._util_tv_cache_turn = this.me.turn;
        }

        return this._util_tv_cache_map;
    }

    /**
     * Returns a cached version of a list of robots in true vision range
     */
    getTruelyVisibleRobots() {
        const outdated = this._util_true_vision_turn !== this.me.turn;

        if (outdated) {
            this._util_true_vision_list = this.getVisibleRobots().filter(r => this.isVisible(r));
            this._util_true_vision_turn = this.me.turn;
        }

        return this._util_true_vision_list;
    }

    /**
     * Get the base karbonite float this team is playing with
     */
    getBaseKarboniteFloat() {
        return this._strats.BASE_KARB_FLOAT == null ? 60 : this._strats.BASE_KARB_FLOAT;
    }

    /**
     * Get [x, y] direction vector towards enemy side. undefined if not known
     */
    getForwardDirection() {
        // Determine forward direction by checking the first known castle
        // that is clearly on one side of the map (not exactly the mirror axis)
        if (!this._util_forward_direction) {
            let castles = this.worldKnowledge
                .filter(r => r.unit === SPECS.CASTLE && r.x != null);

            let half = (this.map.length - 1) / 2;

            for (let i = 0; i < castles.length; ++i) {
                let axis = this.isXAxisMirrored()
                    ? castles[i].y
                    : castles[i].x;

                // Skip directly on axis, ambiguous
                if (axis === half) continue;

                if ((axis < half) ^ (castles[i].team === this.me.team)) {
                    // Attacking towards -Infinity
                    this._util_forward_direction = this.isXAxisMirrored()
                        ? [0, -1]
                        : [-1, 0];
                } else {
                    // Atacking towards Infinity
                    this._util_forward_direction = this.isXAxisMirrored()
                        ? [0, 1]
                        : [1, 0];
                }

                break;
            }
        }

        // If that fails, determine by RED/BLUE
        // TODO: May not be reliable
        if (!this._util_forward_direction) {
            let forward = this.me.team === SPECS.RED ? 1 : -1;
            if (this.isXAxisMirrored()) {
                return [0, forward];
            } else {
                return [forward, 0];
            }
        }

        return this._util_forward_direction;
    }

    truelyPassableAbsolute(x, y, tvmap) {
        return this.truelyPassableDelta(x - this.me.x, y - this.me.y, tvmap);
    }

    time(lambda, msg) {
        // Return fast in competition mode
        if (COMPETITION_MODE || NO_TIMING) return lambda();

        const start = new Date().getTime();    
        const result = lambda();
        const total = new Date().getTime() - start;
        this.log((msg || "Timing ") + " in " + total + " ms");
        return result;
    }

    timeCheck(lambda, msg, delta) {
        // Return fast in competition mode
        if (COMPETITION_MODE || NO_TIMING) return lambda();

        delta = delta || 5;
        const start = new Date().getTime();    
        const result = lambda();
        const total = new Date().getTime() - start;
        if (total >= delta) {
            this.log("⏱️   Runtime of " + msg + " is excessive: " + total + " ms");
        }
        return result;
    }

    /**
     * Check wether the terrain at the specified offset is truely passable.
     * That is the terrain is inside map boundaries, the base terrain is passable
     * and the spot is not blocked by a unit if within vision range.
     * @param {number} dx X offset from current position
     * @param {number} dy Y offset from current position
     * @param {array} tvmap True vision passable map, will be generated if none passed
     */
    truelyPassableDelta(dx, dy, tvmap) {
        if (tvmap === undefined) tvmap = this.generateTrueVisionPassableMap();
    
        const height = this.map.length;
        const width = this.map[0].length;
        const x = this.me.x + dx;
        const y = this.me.y + dy;
        
        if (x < 0 || y < 0 || x >= width || y >= height) {
            return false;
        }
        return tvmap[y][x];
    }

    /**
     * Return whether the specified robot type identifier is a movable robot
     * @param {number} unit Type to examine, if none specified take current type
     */
    isRobot(unit) {
        if (unit === undefined) unit = this.me.unit;

        return unit === SPECS.PILGRIM
            || unit === SPECS.CRUSADER
            || unit === SPECS.PROPHET
            || unit === SPECS.PREACHER;
    }

    /**
     * Return whether the given absolute positions are on the same mirror side of the map.
     * Being on the mirror axis on uneven length maps always returns true.
     */
    isSameSide(x1, y1, x2, y2) {
        // Half axis, will be on a fraction if map even (cannot compare equally)
        const half = (this.map.length - 1) / 2;

        if (this.isXAxisMirrored()) {
            if (y1 === half || y2 === half) return true;
            return (y1 < half) === (y2 < half);
        } else {
            if (x1 === half || x2 === half) return true;
            return (x1 < half) === (x2 < half);
        }
    }

    /**
     * Return true if the map is mirrored across the x axis, false if mirrored across y
     */
    isXAxisMirrored() {
        // Check result cache
        if (this._util_xmirror !== undefined) return this._util_xmirror;

        const height = this.map.length;
        const width = this.map[0].length;

        const xUpper = Math.floor(width / 2);
        const yUpper = Math.floor(height / 2);

        for (let x = 0; x < xUpper; ++x) {
            for (let y = 0; y < yUpper; ++y) {
                const mirroredX = width - 1 - x;
                const mirroredY = height - 1 - y;

                // If mirrored Y disagrees, not x-axis mirrored
                if (this.map[y][x] !== this.map[mirroredY][x]) {
                    this._util_xmirror = false;
                    return false;
                }
                // If mirrored X disagrees, not y-axis mirrored 
                else if (this.map[y][x] !== this.map[y][mirroredX]) {
                    this._util_xmirror = true;
                    return true;
                }
            }
        }

        // Failed to find any mismatches, appears to be both x-axis and y-axis
        // mirrored, therefore return true
        this._util_xmirror = true;
        return true;
    }

    /**
     * Mirror the given absolute coordinates according to the map's mirror axis.
     * Return mirrored coordinates in form [x, y]
     * @param {number} x 
     * @param {number} y 
     */
    mirror(x, y) {
        if (this.isXAxisMirrored()) {
            return [x, this.map.length - 1 - y];
        } else {
            return [this.map[0].length - 1 - x, y];
        }
    }

    /**
     * Return the mirrored position of the given absolute church placement if this church placement
     * is feasible for mirrored self expansion.
     * @param {number} x 
     * @param {number} y 
     */
    mirrorIfChurchExtendable(x, y) {
        if (!this._strats.MIRROR_FROM_CHURCH_EXPAND) return null;

        x = (x == null) ? this.me.x : x;
        y = (y == null) ? this.me.y : y;

        // Only mirror churches forward, otherwise cause ping-ponging
        if (this.calculateOffensiveness(x, y) >= 0) return null;

        const mirror = this.mirror(this.me.x, this.me.y);

        const distance = chebyshevDistance(this.me.x, this.me.y, ...mirror);

        if (distance > STRUCTURE_MINING_INFLUENCE) {
            return mirror;
        } else {
            return null;
        }
    }

    /**
     * Return a map containing both fuel and karbonite
     */
    getResourceMap() {
        if (this._util_resource_map === undefined) {
            let map = Array.filled2D(this.map.length, this.map.length, false);

            for (let y = 0; y < this.map.length; ++y) {
                for (let x = 0; x < this.map.length; ++x) {
                    map[y][x] = this.fuel_map[y][x] || this.karbonite_map[y][x];
                }
            }

            this._util_resource_map = map;
        }

        return this._util_resource_map;
    }

    /**
     * Return the tile in form [[dx, dy], heuristic] which is best to attack if already in range. 
     * Returns null for the tuple [dx, dy] if no tile is beneficial to attack.
     */
    findBestAttackSquareWithHeuristic() {
        const attackRadiiSq = SPECS.UNITS[this.me.unit].ATTACK_RADIUS;

        if (!attackRadiiSq) throw Error("This unit cannot attack");

        const myDamage = SPECS.UNITS[this.me.unit].ATTACK_DAMAGE;

        const robotMap = this.getVisibleRobotMap();

        const deltas = this.listDeltaTiles(...attackRadiiSq);
        const spreadDeltas = this.listDeltaTiles(0, SPECS.UNITS[this.me.unit].DAMAGE_SPREAD || 0);

        // Bonus for damaging unseen tiles with an AoE unit
        const AOE_UNSEEN_BONUS = 0.01;

        // Do some aliasing for performance, appearantly this function was slow
        const MY_X = this.me.x;
        const MY_Y = this.me.y;
        const MY_TEAM = this.me.team;
        const SIZE = this.map.length;

        // Set minimum score to bonus of hitting all unseen tiles to not
        // return a tile with good score, hitting just out of vision range
        let bestScore = AOE_UNSEEN_BONUS * spreadDeltas.length;
        let bestTile = null;

        for (let i = 0; i < deltas.length; ++i) {
            let score = 0;

            const tx = MY_X + deltas[i][0];
            const ty = MY_Y + deltas[i][1];

            // Skip if target out of map
            if (tx < 0 || ty < 0 || tx >= SIZE || ty >= SIZE) {
                continue;
            }

            for (let j = 0; j < spreadDeltas.length; ++j) {
                const x = tx + spreadDeltas[j][0];
                const y = ty + spreadDeltas[j][1];

                if (x < 0 || y < 0 || x >= SIZE || y >= SIZE) continue;

                const id = robotMap[y][x];

                if (id > 0) {
                    const bot = this.worldKnowledge.findById(id);
                    const damage = bot.damage || 0;
                    const willKill = SPECS.UNITS[bot.unit].STARTING_HP - damage - myDamage <= 0;

                    const stackDamage = damage / SPECS.UNITS[bot.unit].STARTING_HP;
                    
                    // prefer units that can attack me
                    const distanceSq = squaredEuclideanDistance(MY_X, MY_Y, bot.x, bot.y);
                    let attackRadius = SPECS.UNITS[bot.unit].ATTACK_RADIUS
                        ? SPECS.UNITS[bot.unit].ATTACK_RADIUS
                        : [0, 0];

                    const canAttackMe = distanceSq <= attackRadius[1] && distanceSq >= attackRadius[0];

                    // prefer units that deal most damage
                    const botDamage = SPECS.UNITS[bot.unit].ATTACK_DAMAGE;

                    // Base score for every hit bot, prefer killing units, 
                    // slightly prefer targeting weak units, very slightly prefer targeting
                    // high unit ids to have units focus the same unit
                    let botScore = 10 + (willKill ? 5 : 0) + stackDamage * 2 + canAttackMe * 6 + botDamage * 0.2 + id * 0.00001;

                    if (bot.team === MY_TEAM) {
                        score -= botScore;
                    } else {
                        score += botScore;
                    }
                }
                // For AoE, prefer saturating invisible tiles to damage more unseen enemies
                // Already checked earlier not to include out of bounds tiles
                else if (id < 0) {
                    score += AOE_UNSEEN_BONUS;
                }
            }

            if (score > bestScore) {
                bestScore = score;
                bestTile = deltas[i];
            }
        }

        return [bestTile, bestScore];
    }

    /**
     * Return the tile in form [dx, dy] which is best to attack if already in range. 
     * Returns null if no tile is beneficial to attack.
     */
    findBestAttackSquare() {
        return this.findBestAttackSquareWithHeuristic()[0];
    }

    findClosestVisiblePredicate(predicate) {
        const units = this.getTruelyVisibleRobots();

        let bestRadiusSq = Infinity;
        let bestUnit = null;

        for (let i = 0; i < units.length; ++i) {
            if (!predicate(units[i])) continue;

            const dx = this.me.x - units[i].x;
            const dy = this.me.y - units[i].y;

            const radiusSq = dx * dx + dy * dy;

            if (radiusSq < bestRadiusSq) {
                bestRadiusSq = radiusSq;
                bestUnit = units[i];
            }
        }

        return bestUnit;
    }

    /**
     * Find the closest visible unit (that is ignoring units just radioing)
     * with the specified filter. Returns either the unit or null if none found.
     * @param {number | null} team Team to filter by or null for any team 
     * @param {number | null} unit Unit type to filter by or null for any type
     */
    findClosestVisible(team, unit) {

        const units = this.listVisible(team, unit);

        let bestRadiusSq = null;
        let bestUnit = null;

        for (let i = 0; i < units.length; ++i) {
            const u = units[i];

            const radiusSq = Math.pow(this.me.x - u.x, 2) + Math.pow(this.me.y - u.y, 2);
            if (bestRadiusSq === null || radiusSq < bestRadiusSq) {
                bestRadiusSq = radiusSq;
                bestUnit = u;
            }
        }

        return bestUnit;
    }

    /**
     * Return a human readable string for the specified unit type id
     * @param {number | undefined} unit Unit type to format, take own type if undefined
     */
    formatUnit(unit) {
        if (unit === undefined) unit = this.me.unit;

        return ["Castle", "Church", "Pilgrim", "Crusader", "Prophet", "Preacher"][unit];
    }

    logGlobalTurn() {
        if (COMPETITION_MODE) return;
        if (this.me.unit === SPECS.CASTLE) {
            this.log("Clock time requested by " + this.me.id + " is " + this.me.turn);
        } else {
            this.castleTalkSetEventMessage(CASTLETALK_PRIO.DBG_CLOCK_REQEUST, castleTalkMessage("dbgClock"));
        }
    }

    /**
     * List all absolute coordinates from which this unit can attack any of the specified units
     * @param {array | object} units Single unit or list of units
     */
    listAttackTiles(units) {
        const attackRadiiSq = SPECS.UNITS[this.me.unit].ATTACK_RADIUS;

        if (!attackRadiiSq) throw Error("This unit cannot attack");

        return this.listDistanceTiles(units, attackRadiiSq[0], attackRadiiSq[1]);
    }

    /**
     * List all absolute coordinates in form [x, y] that can be used to drop off resources to any of the specified units.
     * @param {array | object} units List of units or single unit object
     */
    listDropoffTiles(units) {
        return this.listDistanceTiles(units, 1, 2);
    }

    /**
     * List all absolute coordinates in form [x, y] within the specified distances to any of the specified units.
     * @param {array | object} units List of units or single unit object
     * @param {number} minRadiusSq Minimum squared radius 
     * @param {number} maxRadiusSq Maximum squared radius
     */
    listDistanceTiles(units, minRadiusSq, maxRadiusSq) {
        if (!Array.isArray(units)) units = [units];

        const deltas = this.listDeltaTiles(minRadiusSq, maxRadiusSq);

        let result = [];

        for (let i = 0; i < units.length; ++i) {
            const u = units[i];

            for (let j = 0; j < deltas.length; ++j) {
                const x = u.x + deltas[j][0];
                const y = u.y + deltas[j][1];

                // Filter absolute values outside map
                if (x < 0 || y < 0 || x >= this.map.length || y >= this.map.length) continue;

                result.push([x, y]);
            }
        }

        // Remove any duplicates from the result
        result = coordinatesRemoveDoubles(result);

        return result;
    }

    /**
     * List all delta distances in form [dx, dy] within the inclusive
     * specified squared radii, sorted from least to highest radius
     * @param {number} minRadiusSq 
     * @param {number} maxRadiusSq 
     */
    listDeltaTiles(minRadiusSq, maxRadiusSq) {
        let result = [];

        const maxRadius = Math.ceil(Math.sqrt(maxRadiusSq));

        for (let dx = -maxRadius; dx <= maxRadius; ++dx) {
            for (let dy = -maxRadius; dy <= maxRadius; ++dy) {
                const radiusSq = dx * dx + dy * dy;
                if (minRadiusSq <= radiusSq && radiusSq <= maxRadiusSq) {
                    result.push([dx, dy]);
                }
            }
        }

        result.sort((l, r) => l[0] * l[0] + l[1] * l[1] - r[0] * r[0] - r[1] * r[1]);

        return result;
    }

    /**
     * Create a list of all possible moves in format [dx, dy] for the given unit type,
     * not including the stationary move [0, 0]
     * @param {number | undefined} unit Unit type to return list for, own type if not specified
     */
    listPossibleMoves(unit) {
        if (unit === undefined) unit = this.me.unit;

        return this.listDeltaTiles(1, SPECS.UNITS[unit].SPEED);
    }

    /**
     * List visible units (that is ignoring units just radioing)
     * with the specified filter. Returns list of unit objects not including self.
     * @param {number | null} team Team to filter by or null for any team 
     * @param {number | null} unit Unit type to filter by or null for any type
     */
    listVisible(team, unit) {
        const units = this.getTruelyVisibleRobots();

        let result = [];

        for (let i = 0; i < units.length; ++i) {
            const u = units[i];

            if (this.me.x === u.x && this.me.y === u.y) continue; // Skip self (Is this actually required?)
            if (team != null && team !== u.team) continue;       // Skip team mismatch
            if (unit != null && unit !== u.unit) continue;       // Skip unit type mismatch

            result.push(u);
        }
        return result;
    }

    /**
     * Convert the given unit object, [x, y] array or x and y parameters from absolute to [dx, dy] coordinates.
     */
    makeRelative(arg1, arg2) {
        if (Array.isArray(arg1)) {
            var x = arg1[0];
            var y = arg1[1];
        } else if (typeof arg1 === 'object' && arg1 !== null) {
            var x = arg1.x;
            var y = arg1.y;
        } else {
            var x = arg1;
            var y = arg2;
        }

        if (x === undefined || y === undefined) throw Error("Invalid arguments");

        return [x - this.me.x, y - this.me.y];
    }

    /**
     * Get the navigation action to navigate to the given target. Returns null if navigation is not
     * possible or required (because already on target). This function efficiently caches paths.
     * Note: This function currently will not improve a path if available.
     * @param {array} targets Absolute target in form [x, y], or list theirof
     * @param {number} mode Navigation mode, defaults to NAV.ECONOMIC
     */
    navigatePath(targets, mode) {
        const navMove = this.navigationMove(targets, mode);
        if (navMove) {
            return this.move(...navMove);
        } else {
            return null
        }
    }

    /**
     * Returns the navigation move to navigate to the given target. Returns null if navigation is not
     * possible or required (because already on target). This function efficiently caches paths.
     * Note: This function currently will not improve a path if available.
     * @param {array} targets Absolute target in form [x, y], or list theirof
     * @param {number} mode Navigation mode, defaults to NAV.ECONOMIC
     */
    navigationMove(targets, mode) {

        // Fail fast if frozen last turn to bank computation time if constantly overdrawing clock
        if (this._util_frozen || this.me.time < 40) {
            this.log("⚠️ Refusing to navigate: low clock budget");
            return null;
        }

        // Promote targets to 2d if 1d given
        if (!Array.isArray(targets[0])) targets = [targets];

        mode = mode || NAV.ECONOMIC;

        // Return fast if already on target
        for (let i = 0; i < targets.length; ++i) {
            if (this.me.x === targets[i][0] && this.me.y === targets[i][1]) return null;
        }

        let recalculate = false;

        // this._util_path will contain the path to the target, where the 0-th element is the
        // current element, that is the element the robot is expected to be standing on prior
        // to invoking the function. This allows to check whether the returned action was actually
        // taken.

        // If target changed or was never set
        if (this._util_path_targets === undefined || !equalsnd(this._util_path_targets, targets)) {
            recalculate = true;
        } 
        // If navigation mode changed
        else if (this._util_path_mode !== mode) {
            recalculate = true;
        }
        // Or if robot is not positioned where expected
        else if (!equalsnd(this._util_path[0], [this.me.x, this.me.y])) {
            recalculate = true;
        }
        // Or if next step is not possible, then must recalculate
        else if (!this.truelyPassableAbsolute(...this._util_path[1])) {
            recalculate = true;
        }

        // If path must be recalculated, do so
        if (recalculate) {
            this._util_path = this.findPath(targets, mode);

            // If no path, clear target and fail
            if (!this._util_path) {
                this._util_path_targets = undefined;
                return null;
            }
            // Else set valid target and mode
            this._util_path_targets = targets;
            this._util_path_mode = mode;
        }

        // Calculate delta
        const dx = this._util_path[1][0] - this.me.x;
        const dy = this._util_path[1][1] - this.me.y;

        // Project fuel cost
        const fuelCost = SPECS.UNITS[this.me.unit].FUEL_PER_MOVE * (dx * dx + dy * dy);

        // Bail if out of fuel. Prevents missing the returned action, requiring a costly
        // recalculation of the path as the robot wouldn't be in the expected updated
        // position next turn
        if (fuelCost > this.fuel) return null;

        // Slice away current position from path
        this._util_path = this._util_path.slice(1);

        return [dx, dy];
    }

    euclideanPathLength(path) {
        let length = 0;

        for (let i = 0; i < path.length - 1; ++i) {
            const dx = path[i+1][0] - path[i][0];
            const dy = path[i+1][1] - path[i][1];
            length += Math.sqrt(dx * dx + dy * dy);
        }

        return length;
    }

    listAllConstructSpots() {
        // Cache result
        if (this._util_all_construct_spots == null) {

            // Cannot find expansions until negotiated
            if (this._wl_castle_state === CASTLE_STATE.NEGOTIATE_MASTER) {
                return;
            }

            let result = {};

            const forward = this.getForwardDirection();

            for (let y = 0; y < this.map.length; ++y) {
                for (let x = 0; x < this.map.length; ++x) {
                    if (this.karbonite_map[y][x] || this.fuel_map[y][x]) {
                        const obj = this.findBestConstructSpotWithScore(x, y, forward);
                        if (obj) {
                            result["" + obj.x + "," + obj.y] = obj;
                        }
                    }
                }
            }

            this._util_all_construct_spots = Object.values(result);

            const alliedCastles = this.worldKnowledge.filter(r => r.team === this.me.team && r.unit < 2).map(c => [c.x, c.y]);
            const enemyCastles = alliedCastles.map(t => this.mirror(...t));
            const allCastles = alliedCastles.concat(enemyCastles);

            let total = 0;
            let totalUnprotected = 0;

            // Iterate to count total resources as well as protected total resources
            for (let i = 0; i < this._util_all_construct_spots.length; ++i) {
                const spot = this._util_all_construct_spots[i];
                let isUnprotected = true;
                for (let j = 0; j < allCastles.length; ++j) {
                    if (squaredEuclideanDistance(...allCastles[j], spot.x, spot.y) < 11 * 11) {
                        isUnprotected = false;
                        break;
                    }
                }
                total += spot.resources;
                spot.unprotected = isUnprotected;
                if (isUnprotected) totalUnprotected += spot.resources;
            }

            // Iterate to set relative amounts
            for (let i = 0; i < this._util_all_construct_spots.length; ++i) {
                const spot = this._util_all_construct_spots[i];
                spot.relativeTotal = spot.resources / total;
                spot.relativeUnprotected = spot.unprotected
                    ? spot.resources / totalUnprotected
                    : 0.0;
            }

            this.log(JSON.stringify(this._util_all_construct_spots));
        }

        return this._util_all_construct_spots;
    }

    findBestConstructSpot(xBase, yBase, forward) {
        let obj = this.findBestConstructSpotWithScore(xBase, yBase, forward);

        if (obj) return [obj.x, obj.y];
        else return obj;
    }

    /**
     * Find the best construction spot close to the specified base coordinates
     * Returns object or null if none found
     */
    findBestConstructSpotWithScore(xBase, yBase, forward, maxOffset, placementPassableMap) {
        // Positive/negative maximum deviance from base both axis
        const MAX_OFFSET = maxOffset || STRUCTURE_MINING_INFLUENCE;

        placementPassableMap = placementPassableMap || this.map;

        // Size of the kernel used to score resources
        const RESOURCE_KERNEL_SIZE = 5;

        // Scoring factor multiplied with inverse distance to resource
        const RESOURCE_FACTOR = 2;

        // Scoring factor applied negatively for blocked space in moore neighbourhood
        const BLOCK_FACTOR = 1;

        const xMin = Math.max(0, xBase - MAX_OFFSET);
        const xMax = Math.min(this.map.length - 1, xBase + MAX_OFFSET);
        const yMin = Math.max(0, yBase - MAX_OFFSET);
        const yMax = Math.min(this.map.length - 1, yBase + MAX_OFFSET);

        let spot = null;
        let bestScore = -Infinity;

        for (let x = xMin; x <= xMax; ++x) {
            for (let y = yMin; y <= yMax; ++y) {
                // Skip if on resource
                if (this.karbonite_map[y][x] || this.fuel_map[y][x]) continue;
                // Skip if blocked
                if (!placementPassableMap[y][x]) continue;

                let score = 0;
                let resources = 0;

                // Subtract from score for every blocked space in moore neighbourhood
                for (let dx = -1; dx <= 1; ++dx) {
                    for (let dy = -1; dy <= 1; ++dy) {
                        const nx = x + dx, ny = y + dy;
                        if (nx < 0 || ny < 0 || nx >= this.map.length || ny >= this.map.length || !this.map[ny][nx]) {
                            score -= BLOCK_FACTOR;
                        }
                    }
                }

                // Add for every resource by inverse distance
                for (let dx = -RESOURCE_KERNEL_SIZE; dx <= RESOURCE_KERNEL_SIZE; ++dx) {
                    for (let dy = -RESOURCE_KERNEL_SIZE; dy <= RESOURCE_KERNEL_SIZE; ++dy) {
                        const nx = x + dx, ny = y + dy;
                        if (nx < 0 || ny < 0 || nx >= this.map.length || ny >= this.map.length) {
                            continue;
                        }

                        if (this.karbonite_map[ny][nx] || this.fuel_map[ny][nx]) {
                            // Inverse Chebyshev
                            score += RESOURCE_FACTOR / Math.max(Math.abs(dx), Math.abs(dy));
                            resources += 1;
                        }
                    }
                } 

                // if we have a forward vector, influence score by being as back as possible
                // unless the strategy wants curches as forward as possible
                if (forward) {
                    if (this._strats.PLACE_CHURCH_FORWARD) {
                        score += (x * forward[0] + y * forward[1]) / 1000;
                    } else {
                        score -= (x * forward[0] + y * forward[1]) / 1000;
                    }
                }

                if (score > bestScore) {
                    bestScore = score;
                    spot = {x: x, y: y, score: score, resources: resources };
                }
            }
        }

        return spot;
    }

    /**
     * Find the best relative build spot surrounding the current unit. If target is specified,
     * will take the closest spot to target by manhattan distance, otherwise will take
     * any available spot. Returns null if no free spots, otherwise returns the build spot
     * in form [dx, dy].
     * @param {array} target Absolute mission target of build unit in [x, y], optional
     * @param {number} buildSpotUnit Unit to be build
     * @param {boolean} emergency If an emergency, do not penalize blocking economy
     */
    findBestBuildSpot(target, buildSpotUnit, emergency) {
        buildSpotUnit = buildSpotUnit || SPECS.PREACHER;
        emergency = emergency || false;

        const tvmap = this.generateTrueVisionPassableMap();

        const deltas = this.listDeltaTiles(1, 2);

        const availableDeltas = deltas.filter(i => this.truelyPassableDelta(i[0], i[1], tvmap));

        if (availableDeltas.length === 0) {
            return null;
        }

        if (target === undefined) {
            return availableDeltas[0];
        }

        const enemyPreacherMap = this.calculateDamageMap(SPECS.PREACHER);

        // Convert absolute target coordinates to relative signed ones to find build spot best
        // agreeing
        const deltaTarget = [Math.sign(target[0] - this.me.x), Math.sign(target[1] - this.me.y)];

        let bestScore = Infinity;
        let best = null;

        for (let i = 0; i < availableDeltas.length; ++i) {
            const delta = availableDeltas[i];
            let score = Math.abs(delta[0] - deltaTarget[0]) + Math.abs(delta[1] - deltaTarget[1]);

            const x = delta[0] + this.me.x;
            const y = delta[1] + this.me.y;

            if (enemyPreacherMap && enemyPreacherMap[y][x] >= SPECS.UNITS[buildSpotUnit].STARTING_HP) continue;

            const onTarget = target && x === target[0] && y === target[1];

            // Penalize building on resource unless target or emergency
            if ((this.karbonite_map[y][x] || this.fuel_map[y][x]) && !onTarget && !emergency) {
                score += 3;
            }

            // Take best score
            if (score < bestScore) {
                bestScore = score;
                best = delta;
            }
        }

        return best;
    }

    /**
     * Returns best relative dodge move.
     * first priority is lowest damage, second is farthest distance
     * returns null if dodging doesnt make sense
     * @param {*} possibleDodgeTiles 
     * @param {*} damageMap 
     */
    findBestDodgeSpot(damageMap) {

        const allMoves = this.listPossibleMoves();

        let lowestDamage = Infinity;
        let highestDistance = -Infinity;
        let bestMove = null;
    
        for (let i = 0; i < allMoves.length; ++i) {
            const move = allMoves[i];
            const position = [this.me.x + move[0], this.me.y + move[1]];
            if (position[0] < 0 || position[0] >= this.map.length || position[1] < 0 || position[1] >= this.map.length) { 
               // tile outside
                continue;
            }
            const damage = damageMap[position[1]][position[0]];
            if (damage === null) {
                // not passable
                continue
            }
            const distance = schierDistance(this.me.x, this.me.y, ...position)
            if (damage < lowestDamage || (damage === lowestDamage && distance > highestDistance)) {
                // new best dodge move
                lowestDamage = damage;
                highestDistance = distance;
                bestMove = move;
            }
        }

        const standingDamage = damageMap[this.me.y][this.me.x];
        if (standingDamage <= lowestDamage) {
            // Dodging wont make sense here
            return [null, standingDamage];
        } else {
            return [bestMove, lowestDamage];
        }
    }

    findBestDodgeSpotPassive(damageMap) {
        let closestEnemy = this.findClosestVisible(1 - this.me.team, null);
        const allMoves = this.listPossibleMoves();

        let highestDistance = -Infinity;
        let lowestDamage = Infinity;
        let bestMove = null;

        for (let i = 0; i < allMoves.length; ++i) {
            const move = allMoves[i];
            const position = [this.me.x + move[0], this.me.y + move[1]];
            if (position[0] < 0 || position[0] >= this.map.length || position[1] < 0 || position[1] >= this.map.length) { 
               // tile outside
                continue;
            }
            const damage = damageMap[position[1]][position[0]];
            if (damage === null) {
                // not passable
                continue
            }
            const distance = squaredEuclideanDistance(...position, closestEnemy.x, closestEnemy.y)
            if (distance > highestDistance || (distance === highestDistance && damage < lowestDamage)) {
                // new best dodge move
                lowestDamage = damage;
                highestDistance = distance;
                bestMove = move;
            }
        }

        return [bestMove, lowestDamage]
    }

    findBestAggressiveMoveCombat(target, damageMap) {
        const allMoves = this.listPossibleMoves();

        let shortestDistance = Infinity;
        let lowestDamage = Infinity;
        let bestMove = null;

        for (let i = 0; i < allMoves.length; ++i) {
            const move = allMoves[i];
            const position = [this.me.x + move[0], this.me.y + move[1]];
            if (position[0] < 0 || position[0] >= this.map.length || position[1] < 0 || position[1] >= this.map.length) { 
                // tile outside
                continue;
            }
            const distance = squaredEuclideanDistance(...position, target[0], target[1])
            if (damageMap) { 
                const damage = damageMap[position[1]][position[0]];
                if (damage === null) {
                    // not passable
                    continue
                }
            
                if (distance < shortestDistance || (distance === shortestDistance && damage < lowestDamage)) {
                    // new best dodge move
                    lowestDamage = damage;
                    shortestDistance = distance;
                    bestMove = move;
                }
            } else {
                // Ensure passable
                if (!this.truelyPassableDelta(...move)) continue;
                // only compare distance
                if (distance < shortestDistance) {
                    shortestDistance = distance;
                    bestMove = move;
                }
            }
        }

        return [bestMove, lowestDamage];
    }

    /**
     * Return a beneficial move to unclutter while idling or null if no action should be taken
     */
    getIdleMove() {
        // Do not move in any case if just received hold
        if (this._military_hold_turn != null && this.me.turn - this._military_hold_turn <= 5) {
            return;
        }

        // Want stationary move as well for score comparison
        const allMoves = this.listDeltaTiles(0, SPECS.UNITS[this.me.unit].SPEED);
        const passableMap = this.generateTrueVisionPassableMap();
        const robotMap = this.getVisibleRobotMap();

        let bestScore = -Infinity;
        let bestMove = null;
        let stationaryBlocking = false;
        let bestBlocking = false;

        for (let i = 0; i < allMoves.length; ++i) {
            const [dx, dy] = allMoves[i];
            const x = this.me.x + dx, y = this.me.y + dy;

            // Skip unpassable
            if (!this.truelyPassableDelta(dx, dy, passableMap)) continue;

            // Base score is lattice
            const onLattice = !!this._strats.LATTICE_DENSE
                ? !!(x & 1) || !(y & 1)
                : !!(x & 1) === !!(y & 1);
            
            let score = onLattice ? 1.3 : 0;

            let onResource = false;
            let blocksBuildSpot = false;
            let blocksRepulsing = false;

            // Punish idling on resource severely
            if (this.karbonite_map[y][x] || this.fuel_map[y][x]) {
                score -= 3;
                onResource = true;
            }

            // Score moore neighbourhood of unit
            for (let my = -1; my <= 1; ++my) {
                for (let mx = -1; mx <= 1; ++mx) {
                    if (mx === 0 && my === 0) continue;
                    const nx = x + mx, ny = y + my;

                    // Punish boxed in by terrain slightly
                    if (nx < 0 || ny < 0 || nx >= this.map.length || ny >= this.map.length || !this.map[y][x]) {
                        score -= 0.1;
                        continue;
                    }

                    const id = robotMap[ny][nx];

                    if (id <= 0) continue;

                    const robot = this.getRobot(id);

                    // Extremely punish being close to repulsing unit
                    if (this.isRadioing(robot)) {
                        if (decodeRadio(robot.signal).type === "repulse") {
                            score -= 10;
                            blocksRepulsing = true;
                        }
                    }

                    if (robot.unit < 2) {
                        // Always punish building harde
                        score -= 2.5;
                        blocksBuildSpot;
                    }
                }
            }

            const blocking = onResource || blocksBuildSpot || blocksRepulsing;

            // Reward remaining stationary to conserve fuel
            if (dx === 0 && dy === 0) { 
                score += 0.3; 
                stationaryBlocking = blocking;
            }

            if (score > bestScore) {
                bestScore = score;
                bestBlocking = blocking;
                // On stationary move assign null
                bestMove = (dx !== 0 || dy !== 0) ? [dx, dy] : null;
            }
        }

        if (bestMove) return {
            action: this.move(...bestMove),
            important: stationaryBlocking && !bestBlocking
        }
    }

    // -----------------------------------------------
    // Radio talk implementation
    // -----------------------------------------------

    radioSetEventMessage(priority, msg, radiusSq) {
        if (this._util_rd_prio != null && this._util_rd_prio >= priority) return false;

        if (!Array.isArray(msg)) msg = [msg];

        this._util_rd_prio = priority;
        this._util_rd_msg = msg;
        this._util_rd_radiusSq = radiusSq;

        return true;
    }

    radioSendMessage() {
        if (this._util_rd_msg != null && this._util_rd_msg.length > 0) {
            // Send message
            // THIS IS THE ONLY PLACE IN THE FILE ALLOWED TO CALL this.signal()
            // this.log("Sending Radio: " + JSON.stringify(decodeRadio(this._util_rd_msg[0])));
            this.signal(this._util_rd_msg[0], this._util_rd_radiusSq);

            // Dequeue sent part
            this._util_rd_msg = this._util_rd_msg.slice(1);

            // If message completely send, reset pending priority
            if (this._util_rd_msg.length === 0) {
                this._util_rd_prio = null;
            }
        }
    }

    /**
     * Set a pending talk message, if the priority is higher than any
     * other pending talk message. Multi part message will be send from
     * first to last array element over the next turns unless interrupted
     * by higher priority messages.
     * @param {number} priority 
     * @param {number | array} msg Encoded multi or single part message 
     */
    castleTalkSetEventMessage(priority, msg) {

        // If message with higher priority set, discard current
        if (this._util_ct_prio != null && this._util_ct_prio >= priority) return false;

        // Always promote to array (multi part message with one part)
        if (!Array.isArray(msg)) msg = [msg];

        this._util_ct_prio = priority;
        this._util_ct_msg = msg;

        return true;
    }

    /**
     * Send the pending castle talk message, not permissible to be called manually
     * from user class code.
     */
    castleTalkSendMessage() {
        if (this._util_ct_msg != null && this._util_ct_msg.length > 0) {
            // Send message
            // THIS IS THE ONLY PLACE IN THE FILE ALLOWED TO CALL this.castleTalk()
            this.castleTalk(this._util_ct_msg[0]);

            // Dequeue sent part
            this._util_ct_msg = this._util_ct_msg.slice(1);

            // If message completely send, reset pending priority
            if (this._util_ct_msg.length === 0) {
                this._util_ct_prio = null;
            }
        }
    }

    // -----------------------------------------------
    // Unit logic
    // -----------------------------------------------

    militaryLeadChargeAndCharge(direction) {
        direction = direction || this.getForwardDirection();
        this.militaryLeadCharge(direction);
        this._military_charge_end_turn = this.me.turn + CHARGE_DURATION;
        this._military_state = MILITARY_STATE.CHARGE;
        this._military_charge_direction = direction;
        
        const move = this.bestMoveInDirection(...direction);
        if (move) return this.move(...move);
    }

    militaryLeadCharge(direction) {
        if (!this._strats.ALLOW_MILITAY_CHARGE) return false;

        direction = direction || this.getForwardDirection();

        if (!direction) return false;

        const qd = quantifyDirection(...direction);

        // Cannot charge if on cooldown
        if (this._military_charge_end_turn != null && this.me.turn <= this._military_charge_end_turn) return false;

        // Don't charge if fuel capped
        if (this.fuel <= 2000) return false;

        const msg = encodeRadio({
            type: "charge", direction:qd, crusader: true, mage: true, archer: true
        });

        if (this.radioSetEventMessage(RADIO_PRIO.CHARGE, msg, 64)) {
            this.log("⚔️ Commanding charge against: " + direction);
            this._military_charge_end_turn = this.me.turn + CHARGE_DURATION;
            this._military_state = MILITARY_STATE.CHARGE;
            this._military_charge_direction = direction;
            return true;
        } else {
            return false;
        }
    }

    militaryHandleRadio() {

        const robots = this.getVisibleRobots();

        this._wl_ml_radio_id

        for (let i = 0; i < robots.length; ++i) {
            // Skip self
            if (this.me.id === robots[i].id) continue;

            if (!this.isRadioing(robots[i])) continue;

            if (this.isVisible(robots[i]) && robots[i].team === this.me.team) {
                // Trusted by vision
            } else if (this.worldKnowledge.findById(robots[i].id) && this.worldKnowledge.findById(robots[i].id).team === this.me.team) {
                // Trusted by knowledge
            } else {
                // Untrusted
                continue;
            }

            const msg = decodeRadio(robots[i].signal);

            if (msg.type === "hold") {
                // Receive a hold signal, change state to hold and set turn of receiving hold
                // command
                this._military_hold_turn = this.me.turn;
                this._military_state = MILITARY_STATE.HOLD;
            } else if (msg.type === "target") {
                // Overwrite pending additional targets
                if (msg.clearExisting) {
                    this._military_targets = [];
                }

                // Remove doubles
                this._military_targets = this._military_targets.filter(t => t[0] !== msg.x || t[1] !== msg.y);

                this._military_targets.unshift([msg.x, msg.y]);

                this._military_state = MILITARY_STATE.TARGET_TARGETS;
            } else if (msg.type === "targetOnConstruct" && this.me.turn === 1) {
                this._military_state = MILITARY_STATE.TARGET_TARGETS;
                
                this._military_targets = [[msg.x, msg.y]];

                if (msg.alsoMirror) {
                    this.log("SPIEGEL!");
                    this._military_targets.push(this.mirror(msg.x, msg.y));
                }
            } else if (msg.type === "charge") {
                if ((this.me.unit === SPECS.CRUSADER && msg.crusader) ||
                    (this.me.unit === SPECS.PROPHET && msg.archer) ||
                    (this.me.unit === SPECS.PREACHER && msg.mage)) {
                    // Project further than sender can actually see, to not clutter too much
                    const senderChargeDirection = vectorFromQuantifiedDirection(msg.direction, 20);
                    this._military_charge_direction = [
                        robots[i].x - this.me.x + senderChargeDirection[0], 
                        robots[i].y - this.me.y + senderChargeDirection[1]
                    ];

                    this._military_state = MILITARY_STATE.CHARGE;
                    this._military_charge_stuck_counter = 0;
                    this._military_charge_end_turn = this.me.turn + CHARGE_DURATION;

                    this.log("⚔️ Charging in direction: " + this._military_charge_direction);
                }
            }
        }
    }

    /**
     * Return the best expansion for this castle. Returns null if this castle is not
     * in the best position for an expansion or no expansion is available
     */
    castleFindBestExpansion(safest) {
        safest = safest || false;

        // Cannot find expansions until negotiated
        if (this._wl_castle_state === CASTLE_STATE.NEGOTIATE_MASTER) {
            this.log("Cannot find expansion before negtiating")
            return null;
        }

        const alliedStructs = this.worldKnowledge.filter(r => r.team === this.me.team && r.unit < 2);
        const alliedCastles = alliedStructs.filter(r => r.unit === SPECS.CASTLE);

        const onlyCastle = alliedCastles.length <= 1;

        const eCastles = this._castle_strategy.getEnemyCastles();

        let best = null;
        let bestScore = -Infinity;

        const defensibilityMultiplier = safest
            ? -200
            : -2;

        const closenessMultiplier = safest
            ? 80
            : 1;

        const axisMultiplier = safest
            ? 5
            : 30;

        const expansions = this.listAllConstructSpots();

        // Check all expansions that are available
        for (let i = 0; i < expansions.length; ++i) {
            const e = expansions[i];

            // Skip if backoff active
            if (e.backoffUntil != null && e.backoffUntil > this.me.turn) continue;

            // Find the castle responsible for exanding to this tile, bias by id to ensure
            // same resolution on same distance between castles
            let bestCastle = alliedCastles.fnMin(s => squaredEuclideanDistance(e.x, e.y, s.x, s.y) + s.id / 10000);

            // Skip if structure too close
            let bestStructDistance = alliedStructs.fnValMin(s => chebyshevDistance(e.x, e.y, s.x, s.y));

            if (bestStructDistance < MINIMUM_CHURCH_DISTANCE) continue;

            // All good, perform scoring

            // Score defensibility
            const closestEnemyCastle = eCastles.fnMin(t => squaredEuclideanDistance(...t, e.x, e.y));

            // Ignore too close to enemy castles as expansion
            if (closestEnemyCastle && squaredEuclideanDistance(e.x, e.y, ...closestEnemyCastle) < 11 * 11) {
                continue;
            }

            // Calculate aggressiveness of expansion
            const agressiveness = this.calculateOffensiveness(e.x, e.y);

            // Do not agressively expand if forbidden
            if (!this._strats.ALLOW_OFFENSIVE_EXPAND && agressiveness > 0) continue;

            // Want to have neutral agressiveness, to secure axis
            const axisScore = (1 - (agressiveness * agressiveness)) * axisMultiplier;

            // Want to have high yield
            const yieldScore = e.score;

            // Want to slightly prefer own side
            const defensibilityScore = agressiveness * defensibilityMultiplier;

            // Want to prefer expansion without pending danger
            const dangerity = this._castle_strategy.getDanger(e.x, e.y);

            let dangerScore = 0;

            if (dangerity > 0.5) {
                // Real danger, higher than unexplored threshold
                dangerScore = - 10;
            } else if (dangerity > 0.1) {
                // Not explored in potentially dangerous territory
                // Or danger decayed
                dangerScore -= 3;
            }

            // Not exactly the safest
            if (safest && dangerScore < 0) continue;

            // Want to barely minimize travel distance
            // If we are the only castle, we can more accurately predict using our BFS score
            // If other castles exist, must use heuristic to reach consensus (don't know other BFS scores)
            const travelDistance = onlyCastle
                ? this._struct_bfs_scores[e.y][e.x] / 10
                : euclidean(bestCastle.x - e.x, bestCastle.y - e.y);

            // Calculate travel score by dividing distance by map length, upper limit of 1. Invert to prefer close.
            const travelScore = (1 - (Math.min(1, travelDistance / this.map.length))) * closenessMultiplier;

            // Prefer high yield, high agressiveness, low distance
            let score = axisScore + yieldScore + defensibilityScore + travelScore + dangerScore;

            // Determine whether this expansion needs an escort
            let offensive = dangerScore < 0;

            if (score > bestScore) {
                bestScore = score;
                const scores = {danger: dangerScore, yield: yieldScore, axis: axisScore, travel: travelScore, defensibility: defensibilityScore};
                best = {expand: e, castleId: bestCastle.id, offensive: offensive, scores: scores };
            }
        }

        return best;
    }

    /**
     * Executed immediately on the first turn of a unit
     */
    onBirth() {
        // Set logger for kill events
        if (this.me.unit === SPECS.CASTLE) {
            this.worldKnowledge.setInitialSightingCallback(r => this.castleOnUnitSighted(r));
            this.worldKnowledge.setTerminateCallback(r => this.castleOnUnitTerminated(r));
        } else if (this.me.unit === SPECS.PILGRIM) {
            this.worldKnowledge.setTerminateCallback(r => this.pilgrimOnUnitTerminated(r));
        } else {
            this.worldKnowledge.setTerminateCallback(r => this.militaryOnUnitTerminated(r));
        }

        // Set strategies, can be based on team
        this._strats = this.me.team === SPECS.RED
            ? STRATEGY_BOOM_BLUE
            : STRATEGY_BOOM_BLUE;

        // Generally want to identify over castle talk, unless we are a castle.
        // Per definition castles do not send ident messages, instead immediately sending position message
        if (this.me.unit !== SPECS.CASTLE) {
            this.castleTalkSetEventMessage(CASTLETALK_PRIO.IDENT, castleTalkMessage("ident", this.me.unit));
        } else {
            const msg = castleTalkMessage("position", [this.me.x, this.me.y], this.map.length);
            this.castleTalkSetEventMessage(CASTLETALK_PRIO.IDENT, msg);
        }

        // Set home castle if we are a robot
        if (this.isRobot()) {
            // Set home castle
            this.homeStructure = this.findClosestVisiblePredicate(r => r.team === this.me.team && r.unit < 2);

            if (!this.homeStructure) {
                this._wl_target = this.mirror(this.me.x, this.me.y);
                this._worker_state = WORKER_STATE.SCOUT;
                return;
            }

            // Define current target based on mirror of home castle
            this._wl_target = this.mirror(this.homeStructure.x, this.homeStructure.y);

            if (this.isRadioing(this.homeStructure)) {
                const transmission = decodeRadio(this.homeStructure.signal);

                if (transmission.type === "target") {
                    this._wl_target = [transmission.x, transmission.y];
                    this._worker_state = WORKER_STATE.SCOUT;
                } else if (transmission.type === "mine") {
                    this._wl_target = [transmission.x, transmission.y];
                    this._worker_state = transmission.construct
                        ? WORKER_STATE.CONSTRUCT
                        : WORKER_STATE.MINE;
                }

                // Set worker navigation mode based on distance to target
                const oneWay = chebyshevDistance(this.homeStructure.x, this.homeStructure.y,
                    ...this._wl_target);
                
                this._worker_nav_mode = oneWay > 15 ? NAV.ECONOMIC : NAV.FASTEST;
            }

            // If military unit, set state
            if (this.me.unit > SPECS.PILGRIM) {
                this._military_state = MILITARY_STATE.HOLD;
                this._military_targets = [this.mirror(this.homeStructure.x, this.homeStructure.y)];
            }
        } else {
            // Structure
            this.structureInitializeMiningUtilization();

            // Init lattice
            this._lattice = new Lattice(this);
            this._struct_bfs_scores = this.time(() => this.findPath([], NAV.FASTEST, undefined, {unit: SPECS.PROPHET, map: true}), "Create BFS map");
            this._lattice.initialize(this._struct_bfs_scores, this._strats.LATTICE_DENSE);
            this._lattice.registerStructure(this.me.x, this.me.y);

            if (this.me.unit === SPECS.CASTLE) {
                // Initialize communication objects
                this._castle_next_expansion = 0;
                this._next_safe_expand = 0;

                // Indicates the position communication state
                // 1: Await position1
                // 2: Await position2
                this.robotPositionUpdates = {};
                // Contains last known grid
                this.robotGrids = {};

                // Set castle state to negotiate master
                this._wl_castle_state = CASTLE_STATE.NEGOTIATE_MASTER;

                // Initialize strategy
                this._castle_strategy = new Strategy(this.map.length, this.log);
            }
        }
    }

    /**
     * Update the world knowledge for performing an attack against the
     * specified absolute tile
     * @param {number} x
     * @param {number} y
     */
    updateWorldKnowledgeForAttack(x, y) {
        const map = this.getVisibleRobotMap();

        const spreadDeltas = this.listDeltaTiles(0, SPECS.UNITS[this.me.unit].DAMAGE_SPREAD || 0);

        for (let i = 0; i < spreadDeltas.length; ++i) {
            const nx = x + spreadDeltas[i][0];
            const ny = y + spreadDeltas[i][1];

            if (nx < 0 || ny < 0 || nx >= this.map.length || ny >= this.map.length) continue;

            const id = map[ny][nx];

            if (id > 0) {
                this.worldKnowledge.applyDamage(id, SPECS.UNITS[this.me.unit].ATTACK_DAMAGE);
            }
        }
    }

    /**
     * With tuna
     * @param {number} dx 
     * @param {number} dy 
     */
    wrapAttack(dx, dy) {
        // Ensure attack is good
        const nx = this.me.x + dx;
        const ny = this.me.y + dy;

        if (nx < 0 || ny < 0 || nx >= this.map.length || ny >= this.map.length) {
            throw Error("Attacking bad absolute position (" + nx + ", " + ny + ")");
        }
        if (this.me.unit !== SPECS.PREACHER) {
            if (this.getVisibleRobotMap()[ny][nx] <= 0) {
                throw Error("Bad attack!");
            }
        }
        if (this.fuel >= SPECS.UNITS[this.me.unit].ATTACK_FUEL_COST) {
            this.updateWorldKnowledgeForAttack(this.me.x + dx, this.me.y + dy);
            // THIS IS THE ONLY LINE IN THIS FILE ALLOWED TO CALL this.attack()
            return this.attack(dx, dy);
        } else {
            this.logGlobalTurn();
            this.log("Insufficient ⛽ for Attack: Want " + SPECS.UNITS[this.me.unit].ATTACK_FUEL_COST + " has " + this.fuel);
        }
    }

    /**
     * Calculate agressiveness
     * @param {number} x X coordinate of unit, defaults to self
     * @param {number} y Y coordinate of unit, defaults to self
     * @param {number} axisX Forward axis, defaults to half
     * @param {number} axisY Forward axis, defaults to half
     */
    calculateOffensiveness(x, y, axisX, axisY) {
        x = (x != null) ? x : this.me.x;
        y = (y != null) ? y : this.me.y;

        const forward = this.getForwardDirection();
        if (forward) {
            const half = (this.map.length - 1) / 2;

            axisX = (axisX != null) ? axisX : half;
            axisY = (axisY != null) ? axisY : half;

            // Calculate agressiveness of expansion from -1 (our edge) to 1 (enemy edge)
            return ((x - axisX) * forward[0] + (y - axisY) * forward[1]) / half;
        } else {
            // Do not know forward, just return 0
            return 0;
        }
    }

    /**
     * returns damage map of cumulative damage that can be dealt by enemy units. tiles containing false are not passable
     */
    calculateDamageMap(unitFilter) {

        let empty = true
        let damageMap = Array.filled2D(this.map.length, this.map.length, 0);
        const visibleRobots = this.listVisible(1 - this.me.team, unitFilter);

        for (let i = 0; i < visibleRobots.length; ++i) {
            const robot = visibleRobots[i];
            if (!SPECS.UNITS[robot.unit].ATTACK_RADIUS || SPECS.UNITS[robot.unit].DAMAGE_SPREAD === null) continue;
            const attackRadius = SPECS.UNITS[robot.unit].ATTACK_RADIUS.slice();

            if (robot.unit === SPECS.PREACHER) {
                // preacher deals one extra field of damage with aoe
                attackRadius[1] = Math.pow(Math.sqrt(attackRadius[1]) + Math.sqrt(SPECS.UNITS[SPECS.PREACHER].DAMAGE_SPREAD), 2);
            }

            const attackTiles = this.listDistanceTiles(robot, ...attackRadius);
            for (let t = 0; t < attackTiles.length; ++t) {
                const tile = attackTiles[t];
                empty = false
                damageMap[tile[1]][tile[0]] += SPECS.UNITS[robot.unit].ATTACK_DAMAGE;
            }
        }
        const passableMap = this.generateTrueVisionPassableMap();
        // set own square to passable, as holding position is valid move
        passableMap[this.me.y][this.me.x] = true;
        damageMap = maskArray(damageMap, passableMap, null)
        return (empty ? null : damageMap);
    }

    // ----------------------------------------------------------------------------------
    // Structure functions
    // ----------------------------------------------------------------------------------

    castleUpdateFromCastleTalk() {
        let visibleRobots = this.getVisibleRobots()

        for (var i = 0; i < visibleRobots.length; ++i) {
            if (visibleRobots[i].castle_talk === 0) {
                continue
            }

            let msg = decryptCastleTalk(visibleRobots[i].castle_talk)
            let robot_id = visibleRobots[i].id

            // Skip self talk
            if (robot_id === this.me.id) continue;

            if (msg.type === "position") {
                // If robot seen for the first time, create bookkeeping objects
                if (!(robot_id in this.robotPositionUpdates)) {
                    this.robotPositionUpdates[robot_id] = 1
                    this.robotGrids[robot_id] = null;
                } 
                
                if (this.robotPositionUpdates[robot_id] === 1) {
                    // robot sent position1
                    this.robotPositionUpdates[robot_id] = 2 // rough, next one is position2
                    this.robotGrids[robot_id] = msg.content
                } else {
                    // position2 is received
                    this.robotPositionUpdates[robot_id] = 1 // accurate, next one is position1 again
                    let tile_size = calculateTileSize(this.map.length);
                    let r_x = this.robotGrids[robot_id][0] * tile_size + msg.content[0]
                    let r_y = this.robotGrids[robot_id][1] * tile_size + msg.content[1]

                    // If this robot is not known (for example through sending IDENT), this is normal
                    // as long as the robot is a castle and we are right at the start of the game.
                    // Castles should not IDENT to faster negotiate positions and roles.
                    if (!this.worldKnowledge.findById(robot_id)) {
                        // Ensure we are still negotiating castle positions
                        if (this._castles_known) {
                            this.log("🛑 Missing IDENT for unit " + robot_id);
                            continue;
                        }

                        this.worldKnowledge.initialSighting(robot_id, this.me.team, SPECS.CASTLE);
                    }

                    this.worldKnowledge.updatePosition(robot_id, r_x, r_y, this.me.turn - 1);
                }
            } else {
                // Robot stopped sending positions, so will continue with rough grid in any case
                this.robotPositionUpdates[robot_id] = 1;

                if (msg.type === "ident") {
                    // On identification message, get to know the robot
                    this.worldKnowledge.initialSighting(robot_id, this.me.team, msg.unit);
                } else if (msg.type === "dbgClock") {
                    this.log("Clock time requested by " + robot_id + " was " + (this.me.turn - 1));
                } else if (msg.type === "alert") {
                    const vector = vectorFromQuantifiedDirection(msg.direction, 8);

                    const r = this.worldKnowledge.findById(robot_id);

                    if (r && r.posUpdateTurn && this.me.turn - r.posUpdateTurn <= 3) {
                        const mx = r.x + vector[0], my = r.y + vector[1];
                        this._castle_strategy.markDangerous(mx, my, 0.2, 0.1);
                        // this.log("Received ALERT from " + robot_id + ", resolving to " + [mx, my]);
                    }
                }
            }

            // In any case update strategy 
            let r = this.worldKnowledge.findById(robot_id);
            if (r) this._castle_strategy.updateFriendly(r);
        }
    }

    pilgrimOnUnitTerminated(r) {
        // Only care about our precious churches
        if (r.team !== this.me.team || r.unit !== SPECS.CHURCH) return;

        // Only care about churches within mining influence
        if (chebyshevDistance(this.me.x, this.me.y, r.x, r.y) > STRUCTURE_MINING_INFLUENCE) return;

        // Only care if we are a miner
        if (this._worker_state !== WORKER_STATE.MINE && this._worker_state !== WORKER_STATE.DROPOFF) return;

        this.log("He's dead Jim, we have the technology, we can rebuild him!");

        // Schedule this worker with reconstruction. If another close church available, will
        // immediately reschedule this worker to mining
        this._wl_target = [r.x, r.y];
        this._worker_state = WORKER_STATE.CONSTRUCT;
    }

    militaryOnUnitTerminated(r) {
        if (r.unit === SPECS.CASTLE && r.team === 1 - this.me.team) {
            this.log("🚩 Enemy castle at " + [r.x, r.y] + " anihilated!");
        }
    }
    
    castleOnUnitSighted(r) {

    }

    castleOnUnitTerminated(r) {
        // count up on defense map
        this._castle_strategy.onUnitDied(r);
    }

    structureBuildLattice(unit) {

        const maxRangeSq = this.me.unit === SPECS.CHURCH ? 100 : null;

        const target = this.timeCheck(() => this._lattice.findBest(maxRangeSq), "lattice.findBest()");

        if (!target) {
            this.log("No lattice targets available");
            return;
        }

        // If this is an agressive expand, build archer lattice, else crusader
        const agressiveness = this.calculateOffensiveness(...target, this.me.x, this.me.y);

        const structureAgressiveness = this.calculateOffensiveness();

        // If no unit specified, build crusader if defensive or archer if agressive
        if (!unit) {
            // If the structure is very agressive, back isn't particularly safe, so build archers everywhere
            if (agressiveness < -0.1 && structureAgressiveness < 0.5) {
                unit = SPECS.CRUSADER;
            } else {
                // Select every lattice tile where second bit on both axis is set (so every 4th tile)
                const isInterWeave = (target[0] & 3) == (target[1] & 3) && !!(target[0] & 1);
                if (isInterWeave && this._strats.LATTICE_INTERWEAVE) {
                    unit = this._strats.LATTICE_INTERWEAVE;
                } else {
                    unit = SPECS.PROPHET;
                }
            }
        }
        unit = unit || (agressiveness < -0.1 ? SPECS.CRUSADER : SPECS.PROPHET);

        const buildSpot = this.findBestBuildSpot(target, unit);

        if (!buildSpot) return;

        const msg = encodeRadio({type: "targetOnConstruct", x: target[0], y: target[1]});

        if (!this.radioSetEventMessage(RADIO_PRIO.TARGET, msg, 2)) return;

        this._lattice.strongPulse(...target);

        return this.buildUnit(unit, ...buildSpot);
    }

    /**
     * Build military when idling, handles reserve management base on agressiveness and position
     */
    structureBuildIdleMilitary(primary) {
        primary = primary || false;

        // Count friendlies in vision
        const visibleArmyCount = this.getTruelyVisibleRobots().count(r => r.team === this.me.team && r.unit > 2);

        // Determine agressiveness of this buildings placement
        const agressiveness = this.calculateOffensiveness();

        let idleKarbReserve = this.getBaseKarboniteFloat() + 100 + visibleArmyCount * 5 - 30 * agressiveness;
        let idleFuelReserve = 2000 + visibleArmyCount * 10 - 150 * agressiveness;

        if (this.me.unit === SPECS.CASTLE) {
            // Prefer castles
            idleKarbReserve -= 15;
            idleFuelReserve -= 75;
        }

        if (primary) {
            // Prefer primary
            idleKarbReserve -= 60;
            idleFuelReserve -= 300;
        }

        // Really prefer already damaged castle
        const healthLoss = this.me.unit === SPECS.CASTLE
            ? (1 - this.me.health / SPECS.UNITS[SPECS.CASTLE].STARTING_HP)
            : 0.0;

        idleKarbReserve -= healthLoss * 80;
        idleFuelReserve -= healthLoss * 400;

        // Screw the strategic reserve, game is about to end
        if (this.me.turn >= 900) idleKarbReserve = 0;

        // If we are the attacker and floating sufficient karb, build attack units
        if (this.canBuild(SPECS.PREACHER, idleKarbReserve, idleFuelReserve)) {
            let unit = this._strats.IDLE_MILITARY_WEIGHTS ? Random.weightedChoice([3, 4, 5], this._strats.IDLE_MILITARY_WEIGHTS) : null;

            // Go full health/cost ratio
            if (this.me.turn >= 950) unit = SPECS.CRUSADER;

            return this.timeCheck(() => this.structureBuildLattice(unit), "structureBuildLattice");
        }
    }

    structureBuildMilitary(unit, karbReserve, fuelReserve, spawnTarget) {
        // Skip if broke :/
        if (!this.canBuild(unit, karbReserve, fuelReserve)) {
            return null;
        }

        // Spawned military units should attack mirrored castle, therefore determine
        // target to find best build spot, unless a target was specified
        spawnTarget = spawnTarget ? spawnTarget : this.mirror(this.me.x, this.me.y);

        const buildSpot = this.findBestBuildSpot(spawnTarget, unit);
            
        if (!buildSpot) {
            this.log("Wanted to build but all tiles occupied :/");
            return null;
        }

        return this.buildUnit(unit, ...buildSpot);
    }

    structureCheckCharge() {
        // If charging allowed and we are defensive (No point charging towards mirror from enemy territory)
        // TODO: More useful fuel estimate

        const terrainAllowsCharge = this.structureTerrainAllowsCharge();

        if (terrainAllowsCharge && this._strats.ALLOW_MIRROR_CHARGE && this.calculateOffensiveness() < 0 && this.fuel > 4000) {
            const sufficientCrusaders = this.countVision(this.me.team)[SPECS.CRUSADER] > 5;

            const canChargeAgain = this._structure_mirror_charge_turn == null || this.me.turn - this._structure_mirror_charge_turn > 20;

            if (sufficientCrusaders && canChargeAgain) {
                const mirror = this.mirror(this.me.x, this.me.y);

                const chargeVector = [mirror[0] - this.me.x, mirror[1] - this.me.y];

                const direction = quantifyDirection(...chargeVector);

                const msg = encodeRadio({type:"charge", direction: direction, crusader: true});

                if (this.radioSetEventMessage(RADIO_PRIO.CHARGE, msg, 100)) {
                    this._structure_mirror_charge_turn = this.me.turn;
                    this.log("⚔️ Charging crusaders towards mirror");
                }
            }
        }
    }

    structureInitializeMiningUtilization() {
        this._struct_mining_util = [];

        let map = this.getVisibleRobotMap();

        const MAX_CHEBY = STRUCTURE_MINING_INFLUENCE;

        const xMin = Math.max(0, this.me.x - MAX_CHEBY);
        const yMin = Math.max(0, this.me.y - MAX_CHEBY);
        const xMax = Math.min(this.map.length - 1, this.me.x + MAX_CHEBY);
        const yMax = Math.min(this.map.length - 1, this.me.y + MAX_CHEBY);

        // Set this field to a high utilization to not immediately
        // consider idle if a church, if a castle want to spam away
        const INITIAL_UTIL = this.me.unit === SPECS.CHURCH ? 5 : 0;

        for (let x = xMin; x <= xMax; ++x) {
            for (let y = yMin; y <= yMax; ++y) {
                if (map[y][x] < 0) continue;

                if (this.karbonite_map[y][x] || this.fuel_map[y][x]) {

                    this._struct_mining_util.push({
                        x: x, y: y, util: INITIAL_UTIL, isKarb: this.karbonite_map[y][x]
                    });
                }
            }
        }
    }

    structureUpdateMiningUtilization() {
        // Update mining utilization
        let map = this.getVisibleRobotMap();

        for (let i = 0; i < this._struct_mining_util.length; ++i) {
            let entry = this._struct_mining_util[i];

            // If occupied by friendly pilgrim, increase utilization
            let occupierId = map[entry.y][entry.x];

            if (occupierId > 0) {
                let r = this.getRobot(occupierId);

                if (r.unit === SPECS.PILGRIM && r.team === this.me.team) {
                    entry.util += 1;
                }
            }

            // Decay over time
            entry.util *= 0.9;
        }
    }

    /**
     * Artificially boost the utilization of a mining stop. Should be used when a new
     * worker is scheduled to the spot to prevent selecting this spot again on subsequent
     * turn when utilization is still low
     */
    structureBoostMiningSpot (target) {
        for (let i = 0; i < this._struct_mining_util.length; ++i) {
            let entry = this._struct_mining_util[i];

            if (entry.x === target[0] && entry.y === target[1]) {
                entry.util += 10;
                return;
            }
        }
    }

    /**
     * Build a miner, optionally tasked with construction
     * @param {object | array} mineTarget Object with x and y members or 2 element array in form [x, y]
     * @param {boolean} construct Whether to issue a construct order
     */
    structureBuildMiner(mineTarget, construct) {
        construct = construct || false;

        // Convert object to tuple
        const target = Array.isArray(mineTarget)
            ? mineTarget
            : [mineTarget.x, mineTarget.y];

        // Build miner
        const buildSpot = this.findBestBuildSpot(target, SPECS.PILGRIM);

        if (!buildSpot) return;

        // Encode signal
        const signal = encodeRadio({
            type: "mine",
            construct: construct,
            x: target[0],
            y: target[1]
        });

        // Determine required radio range
        const r = buildSpot[0] * buildSpot[0] + buildSpot[1] * buildSpot[1];

        // Don't build miner if failed to signal
        if (!this.radioSetEventMessage(RADIO_PRIO.TARGET, signal, r)) {
            return;
        }

        // Boost utilization of selected spot to prevent
        // reselecting immediately
        this.structureBoostMiningSpot(target);

        // Build unit (after sending radio, cause logic)
        return this.buildUnit(SPECS.PILGRIM, ...buildSpot);
    }

    /**
     * Find the best under utilized mining spot as object {x, y, isKarb, util}
     */
    structureFindBestClosestMiningSpot() {
        let worstScore = Infinity;
        let worst = null;

        const workers = this.getTruelyVisibleRobots().count(r => { 
            if (r.team !== this.me.team || r.unit !== SPECS.PILGRIM) return false;
            return chebyshevDistance(this.me.x, this.me.y, r.x, r.y) <= STRUCTURE_MINING_INFLUENCE;
        });

        if (workers > this._struct_mining_util.length * 1.4) {
            // Appears to be quite crowded, limit worker production
            // Probably enemy archers we can't see pushing our workers away
            this.log("🏠 Structure oversaturated with workers");
            return null;
        }

        for (let i = 0; i < this._struct_mining_util.length; ++i) {
            let entry = this._struct_mining_util[i];

            // Ignore high utilization
            if (entry.util > 3) {
                continue;
            }

            const distanceScore = 1 / chebyshevDistance(this.me.x, this.me.y, entry.x, entry.y);

            let score = entry.util - distanceScore;

            if (entry.isKarb) {
                // Bias towards karbonite (lower is better)
                score -= 2;
            }

            if (score < worstScore) {
                worstScore = score;
                worst = entry;
            }
        }

        return worst;
    }

    /**
     * Invoked when all castles are known for the first time
     */
    castleAllCastlesKnown() {
        const castles = this.worldKnowledge.filter(r => r.team === this.me.team && r.unit === SPECS.CASTLE);
            
        let eCastles = [];

        for (let i = 0; i < castles.length; ++i) {
            eCastles.push(this.mirror(castles[i].x, castles[i].y));
        }

        this._castle_strategy.initializeEnemyCastles(eCastles);

        // Initially assume everything forward is dangerous
        const forward = this.getForwardDirection();
        if (forward) {
            this._castle_strategy.markForwardDangerous(forward, this._strats.INITIALLY_CONSIDER_DANGEROUS);
        }

        this.log("Enemy castles are: " + JSON.stringify(eCastles));

        // Find least distance
        let leastDistance = Infinity;
        let bestCastle = null;

        // Primary rush castle is castle closest to the next enemy
        for (let i = 0; i < castles.length; ++i) {
            // Update lattice
            this._lattice.registerStructure(castles[i].x, castles[i].y);

            for (let j = 0; j < eCastles.length; ++j) {
                const e = eCastles[j];
                // Use fastest movement distance metric, bias by id to resolve consistently
                const distance = schierDistance(castles[i].x, castles[i].y, ...e) + castles[i].id / 10000;

                if (distance < leastDistance) {
                    leastDistance = distance;
                    bestCastle = castles[i];
                }
            }
        }

        this._wl_castle_is_closest = (bestCastle.id === this.me.id);

        // If rushing allowed and number of castles matches requirements, rush away
        if (this._strats.RUSH_MAX_CASTLES >= castles.length) {
            if (bestCastle.id === this.me.id) {
                this.log("--- NO DRILL - NO DRILL - NO DRILL ---");
                this.log("    WE ARE RUSHING. THIS IS IT BOYS!  ");
                this.log("--- NO DRILL - NO DRILL - NO DRILL ---");
                this._wl_castle_state = CASTLE_STATE.RUSH;
            } else {
                this._wl_castle_state = CASTLE_STATE.AWAIT_RUSH;
            }
        } else {
            this._wl_castle_state = CASTLE_STATE.HOLD;
        }
    }

    castleUpdateGlobalEconomyStatistics() {
        const UPDATE_TICK_COUNT = 5;

        if (this.me.turn % UPDATE_TICK_COUNT !== 0) return;

        let structures = this.worldKnowledge.filter(r => r.team === this.me.team && r.unit < 2 && r.posUpdateTurn != null);

        let controlledResources = 0;
        let totalResources = 0;

        const expansions = this.listAllConstructSpots();

        if (!expansions) return;

        outer:
        for (let i = 0; i < expansions.length; ++i) {
            const e = expansions[i];
            totalResources += e.resources;
            for (let j = 0; j < structures.length; ++j) {
                if (chebyshevDistance(structures[j].x, structures[j].y, e.x, e.y) <= STRUCTURE_MINING_INFLUENCE) {
                    controlledResources += e.resources;
                    continue outer;
                }
            }
        }

        this._economy_controlled_ratio = controlledResources / totalResources;
        const ratio = Math.pow(0.95, UPDATE_TICK_COUNT);
        this._economy_controlled_ratio_smoothed = this._economy_controlled_ratio_smoothed != null 
            ? this._economy_controlled_ratio_smoothed * ratio + this._economy_controlled_ratio * (1 - ratio)
            : this._economy_controlled_ratio;

        if (this.me.turn % 30 === 0) {
            const percent = Math.round(this._economy_controlled_ratio_smoothed * 1000) / 10;
            this.log("📊 Controlling " + controlledResources + " of " + totalResources + " resources, moving avg " + percent + "%");
        }
    }

    castleRush() {
        const wantedUnit = this._strats.RUSH_ORDER.splice(0, 1)[0];

        let completedRush = false;
        let action = null;

        action = this.structureBuildMilitary(wantedUnit, 0, 0, null);

        // On error just complete rush
        if (!action) completedRush = true;

        // If rush order empty, complete rush
        if (this._strats.RUSH_ORDER.length === 0) completedRush = true;

        // On rush completion, switch state and order attack
        if (completedRush) {
            this._wl_castle_state = CASTLE_STATE.HOLD;
            this.castleOrderAllAttack();
        }

        return action;
    }

    castleEstimateMinerEfficiency(startX, startY, targetX, targetY) {
        const isKarbonite = this.karbonite_map[targetY][targetX];

        const mineTime = isKarbonite
            ? SPECS.UNITS[SPECS.PILGRIM].KARBONITE_CAPACITY / SPECS.KARBONITE_YIELD
            : SPECS.UNITS[SPECS.PILGRIM].FUEL_CAPACITY / SPECS.FUEL_YIELD;

        const twoWayDistance = 2 * schierDistance(startX, startY, targetX, targetY);

        const mineCost = mineTime * SPECS.MINE_FUEL_COST;
        const travelCost = twoWayDistance * SPECS.UNITS[SPECS.CRUSADER].FUEL_PER_MOVE;
        const travelTime = twoWayDistance;

        const totalTime = travelTime + mineTime + 1 /* drop off */;
        const totalCost = travelCost + mineCost;
        const normalizedYield = isKarbonite 
            ? SPECS.UNITS[SPECS.PILGRIM].KARBONITE_CAPACITY * 5
            : SPECS.UNITS[SPECS.PILGRIM].FUEL_CAPACITY;

        // Efficiency = (YIELD - COST) / TIME;
        return (normalizedYield - totalCost) / totalTime;
    }

    castleOrderAllAttack(fuelReserve, target) {

        fuelReserve = fuelReserve || 0;

        // Calculate maximum requried range
        let rangeSq = 0;

        const units = this.worldKnowledge.list();

        for (let i = 0; i < units.length; ++i) {
            const u = units[i];

            // Skip wrong team, civil or structure, position unknown for too long
            if (u.team !== this.me.team || u.unit < 2 || u.posUpdateTurn == null || this.me.turn - u.posUpdateTurn > 3) continue;

            const rsq = squaredEuclideanDistance(this.me.x, this.me.y, u.x, u.y);

            if (rsq > rangeSq) rangeSq = rsq;
        }

        // Order descending by fast attack distance to castle
        let eCastles = this._castle_strategy.getEnemyCastles();

        eCastles.sort((a, b) => {
            return schierDistance(...b, this.me.x, this.me.y) - schierDistance(...a, this.me.x, this.me.y);
        });

        // If we have target, push it
        if (target) eCastles.push(target);

        let best = eCastles[eCastles.length - 1];

        let msg = eCastles.mapEnumerate((i, c) => encodeRadio({
            type: "target",
            clearExisting: i === 0,
            x: c[0],
            y: c[1]
        }));

        // Calculate transmission consumption
        let maximumFuelToSend = Math.ceil((this.fuel - fuelReserve) / msg.length);
        let maximumSendRSq = maximumFuelToSend * maximumFuelToSend;

        // No more than 15 tiles
        const sendRadiusSq = Math.min(maximumSendRSq, rangeSq, 15 * 15);

        // Cool down on attack
        if (this._castle_attack_turn != null && this.me.turn - this._castle_attack_turn < 20) {
            return false;
        } else {
            this._castle_attack_turn = this.me.turn;
        }

        this.log("📡 [" + sendRadiusSq + "²] Starting global offensive against (" + best[0] + ", " + best[1] + ")");
        this.log("📡 [" + sendRadiusSq + "²] Starting global offensive against (" + best[0] + ", " + best[1] + ")");
        this.log("📡 [" + sendRadiusSq + "²] Starting global offensive against (" + best[0] + ", " + best[1] + ")");

        this.radioSetEventMessage(RADIO_PRIO.TARGET, msg, sendRadiusSq);

        return true;
    }

    structureDefend() {

        // Check if we have to defend
        let closestEnemy = this.findClosestVisible(1 - this.me.team, null);

        let visible = this.getTruelyVisibleRobots();
        let hasEnemy = false;

        let enemyCount = [0, 0, 0, 0, 0, 0];

        let friendlyArmyCount = 0;
        let furthestFriendly = 0;

        // TODO: If too much AoE in range, do not build units, pointless

        for (let i = 0; i < visible.length; ++i) {
            let r = visible[i];

            if (r.team === this.me.team) {
                if (r.unit > 2) ++friendlyArmyCount;
                const dist = squaredEuclideanDistance(this.me.x, this.me.y, r.x, r.y);
                if (dist > furthestFriendly) furthestFriendly = dist;
            } else {
                hasEnemy = true;
                enemyCount[r.unit]++;
            }
        }

        let enemyArmyCount = enemyCount[3] + enemyCount[4] + enemyCount[5];
        let enemyTotal = enemyCount.sum();

        // Minimum reserves to allow emergency construction
        const MINIMUM_EMERGENCY_CONSTRUCTION_FUEL = 50 + 20 * friendlyArmyCount;

        if (hasEnemy) {

            const prominentAttacker = enemyCount.argmax();

            // If we are not defending against mainly Preahcer and we are outnumbering the enemy
            // or if we are taking damage, order attack
            if ((prominentAttacker !== SPECS.PREACHER || this._took_damage) && friendlyArmyCount > enemyArmyCount + 1) {
                // Want to radio attack if not fuel starved
                if (this._structure_last_defend_radio == null || this.me.turn - this._structure_last_defend_radio > 5 && this.fuel >= 300) {
                    const msg = encodeRadio({type: "target", x: closestEnemy.x, y: closestEnemy.y, clearExisting: true});
                    if (this.radioSetEventMessage(RADIO_PRIO.TARGET, msg, furthestFriendly)) {
                        this.log("⚔️  Concentrate fire on " + [closestEnemy.x, closestEnemy.y]);
                        this._structure_last_defend_radio = this.me.turn;
                    }
                }
            }

            // Not an emergency if we have more units
            if (enemyTotal < friendlyArmyCount) return;
            
            let want;

            if (squaredEuclideanDistance(this.me.x, this.me.y, closestEnemy.x, closestEnemy.y) < 5 * 5) {
                want = [SPECS.PREACHER, SPECS.CRUSADER];
            } else if (prominentAttacker === SPECS.PREACHER) {
                want = [SPECS.PREACHER, SPECS.PROPHET];
            } else {
                want = [SPECS.PROPHET, SPECS.CRUSADER];
            } 

            for (let i = 0; i < want.length; ++i) {
                if (this.canBuild(want[i], 0, MINIMUM_EMERGENCY_CONSTRUCTION_FUEL)) {
                    let desiredVector = want[i] === SPECS.PROPHET
                        ? [this.me.x - (closestEnemy.x - this.me.x), this.me.y - (closestEnemy.y - this.me.y)]
                        : [closestEnemy.x, closestEnemy.y];

                    let spot = this.findBestBuildSpot(desiredVector, want[i], true /* emergency */);

                    // Want to signal hold
                    this.radioSetEventMessage(RADIO_PRIO.HOLD, encodeRadio({type: "hold"}), 2);

                    if (spot) {
                        return this.buildUnit(want[i], ...spot);
                    }
                }
            }

            // Else just return something truethy to not due some civil stuff
            return {};
        }
    }

    structureTerrainAllowsCharge() {
        if (this._structure_terrain_charge == null) {
            const mirror = this.mirror(this.me.x, this.me.y);

            const eroded = this.structureGetErodedMap();

            if (!eroded) return false;

            const path = this.findPath(mirror, NAV.FASTEST, undefined, {unit: SPECS.PROPHET, tvmap: eroded});

            this._structure_terrain_charge = !!(path && (this.euclideanPathLength(path) <= euclideanDistance(...mirror, this.me.x, this.me.y) * 1.05));

            this.log("Charging allowed from this structure: " + this._structure_terrain_charge);
        }

        return this._structure_terrain_charge;
    }

    structureGetDilatedMap() {
        if (this._structure_dilated_map == null) {
            // Dilating somewhat expensive, don't kill on first turn
            if (this.me.turn !== 1 && this.me.time > 50) {
                this._structure_dilated_map = this.timeCheck(() => this.map.dilateBoolean2D(2), "Dilate map", 10);
            }
        }

        return this._structure_dilated_map;
    }

    structureGetErodedMap() {
        if (this._structure_eroded_map == null) {
            // Eroding somewhat expensive, don't kill on first turn
            if (this.me.turn !== 1 && this.me.time > 50) {
                this._structure_eroded_map = this.timeCheck(() => this.map.erodeBoolean2D(2), "Erode map", 10);
            }
        }

        return this._structure_eroded_map;
    }

    turnChurch() {

        // Reserves wanted to construct local miner
        // Required to save resources for rush defense
        const CHURCH_MINER_FUEL_RESERVE = 250;
        const CHURCH_MINER_KARB_RESERVE = this.getBaseKarboniteFloat();

        let defenseAction = this.structureDefend();

        if (defenseAction) return defenseAction;

        if (!this._church_mirror_handled) {
            const mirror = this.mirrorIfChurchExtendable();

            if (mirror) {
                this.log("⛪ Mirroring expansion required");
                if (this.canBuild(SPECS.PILGRIM, CHURCH_MINER_KARB_RESERVE, CHURCH_MINER_FUEL_RESERVE)) {
                    const act = this.structureBuildMiner(mirror, true);

                    if (act) {
                        this.log("⛪ Building mirror worker for " + mirror);
                        this._church_mirror_handled = true;
                        return act;
                    }
                }
            } else {
                this._church_mirror_handled = true;
            }
        }

        let mineTarget = this.structureFindBestClosestMiningSpot();

        // If mining tile under-utilized build worker
        if (mineTarget && this.canBuild(SPECS.PILGRIM, CHURCH_MINER_KARB_RESERVE, CHURCH_MINER_FUEL_RESERVE)) {
            return this.structureBuildMiner(mineTarget);
        }

        this.structureCheckCharge();

        // Else perform optional idle build action
        return this.structureBuildIdleMilitary();
    }

    turnCastleBase() {
        // First, update game knowledge based on castle talk
        this.castleUpdateFromCastleTalk();

        // Update economy
        this.castleUpdateGlobalEconomyStatistics();

        // Next, clear any cached orders from last turn,
        // important to do this after castle talk interpretation
        // since castle may require this information
        this._castle_last_worker_target = null;

        return this.timeCheck(() => this.turnCastle(), "this.turnCastle()", 10);
    }

    castleExpandAgressively(expand, queue) {
        // Caller responsible for sufficient resource float

        const target = [expand.x, expand.y];

        const buildSpot = this.findBestBuildSpot(target);

        if (!buildSpot) return;

        if (this.me.turn < 120) {

            const targetChanged = target[0] !== this._expansion_target_x || target[1] !== this._expansion_target_y;

            if (targetChanged) {
                this._expansion_target_x = target[0];
                this._expansion_target_y = target[1];

                this._expansion_target_q = queue || [SPECS.CRUSADER];
            }

            const queueCompleted = !this._expansion_target_q.length;

            // Check if escort already tasked

            if (queueCompleted) {
                // If so, construct miner and expand
                const action = this.structureBuildMiner(target, true);

                if (action) {
                    this._castle_next_expansion = Math.ceil(this.me.turn + this._struct_bfs_scores[target[1]][target[0]] / 10 + 4);
                    this.log("Next expansion: " + this._castle_next_expansion);
                }

                this.log("🤔 Sending agressive builder for " + target);
                this.castlePremarkExpandDangerous(expand);

                return action;
            } else {
                // Select next unit from queue
                const unit = this._expansion_target_q[0];

                // If last unit instruct
                if (/*this._expansion_target_q.length === 1*/ true) {
                    // Check if mirror has enough distance to make mirroring useful
                    const mirrorTarget = this.mirror(...target);
                    const mirrorFar = true; //chebyshevDistance(...target, ...mirrorTarget) > 5;

                    // Only mirror if devensive main target
                    const mirrorDefensive = this.calculateOffensiveness(...target) < 0;

                    const mirrorDangerous = this._castle_strategy.isThreatenedByEnemyCastle(...mirrorTarget);

                    const alsoMirror = mirrorFar && mirrorDefensive && !mirrorDangerous && this._strats.ESCORT_TARGET_MIRROR;

                    if (alsoMirror) this.log("SPIEGEL ATTACKE!");

                    const msg = encodeRadio({type: "targetOnConstruct", x: target[0], y: target[1], alsoMirror: alsoMirror});

                    if (!this.radioSetEventMessage(RADIO_PRIO.TARGET, msg, 2)) return;
                }

                this._expansion_target_q = this._expansion_target_q.slice(1);

                this._castle_escort_turn = this.me.turn;

                this.log("🤔 Building escort " + this.formatUnit(unit) + " for " + target);

                return this.buildUnit(unit, ...buildSpot);
            }

        } else if (this._strats.ALLOW_LARGE_SCALE_ATTACK) {

            // Check if we have enough units and fuel to attack
            const visibleArmyCount = this.getTruelyVisibleRobots().filter(r => r.team === this.me.team && r.unit > 2).length;

            let wantArmy = this.me.turn / 20 + 5;

            // Attack earlier if we have advantage
            wantArmy *= (1 - this._economy_controlled_ratio_smoothed) * 2;

            // Travel entire distance and fire some more
            const wantFuel = visibleArmyCount * (6 * chebyshevDistance(this.me.x, this.me.y, ...target) + 100) + 2000 /*base*/;

            if (this.fuel >= wantFuel && visibleArmyCount >= wantArmy) {
                if (this.castleOrderAllAttack(0, target)) {
                    // Return something truethy, this was our main action
                    return {};
                }
            }
        }
    }

    castlePremarkExpandDangerous(expand) {
        // Mark as dangerous (will settle if worker arrives safely)
        // TODO: Communicate?
        this._castle_strategy.markDangerous(expand.x, expand.y);

        const mirrorChurch = this.mirrorIfChurchExtendable(expand.x, expand.y);

        if (mirrorChurch) {
            this._castle_strategy.markDangerous(...mirrorChurch);
        }

        const backoff = euclideanDistance(expand.x, expand.y, this.me.x, this.me.y) + 10;

        expand.backoffUntil = this.me.turn + backoff;
    }

    turnCastle() {
        this._castle_strategy.decayTick();

        // Use castle to update us about game progress
        if (this.me.turn % 100 === 0) {
            this.log("🛵🛵🛵   Die Uhr schlägt " + this.me.turn + " Runden   🛵🛵🛵")
        }

        if (this._wl_castle_state === CASTLE_STATE.NEGOTIATE_MASTER) {
            // If this is the first turn
            if (this.me.turn === 1) {
                // getVisibleRobots contains all existing robots to access castle talk,
                // even if they were not awoken yet. Therefore the castle can easily
                // determine at the start of the first turn, whether it is the only castle.
                const isOnlyCastle = this.getVisibleRobots().length === 1;

                if (isOnlyCastle) {
                    this._castles_known = true;
                    this.castleAllCastlesKnown();
                }
            } else if (this.me.turn === 3 && !this._castles_known) {
                /// All castles should be known by this point and were not previously
                this._castles_known = true;
                this.castleAllCastlesKnown();
            }
        }

        // If rushing just execute rush logic
        if (this._wl_castle_state === CASTLE_STATE.RUSH) {
            return this.castleRush();
        }

        // If we can attack an enemy, do so immediately
        const bestAttack = this.timeCheck(() => this.findBestAttackSquare(), "time.findBestAttackSquare", 3);

        if (bestAttack) {
            return this.wrapAttack(...bestAttack);
        }

        // Else if out of range, but enemy, build defense unit
        let defenseAction = this.timeCheck(() => this.structureDefend(), "this.structureDefend", 2);

        if (defenseAction) return defenseAction;

        // If a friendly castle is rushing and we are early game, return here
        // NOTE: Since we are NEGOTIATING at first, this still allows us to build the first
        // miner
        if (this.me.turn < 9 && this._wl_castle_state === CASTLE_STATE.AWAIT_RUSH) return;

        // Else play macro game
        // Allow constructing exactly one miner in first round
        const ourFirstMiner = this.karbonite === SPECS.INITIAL_KARBONITE && this.me.turn === 1;

        // Query information about our unit composition
        let ownWorkerCount;
        let ownArmyCount;
        let visibleArmyCount;

        this.timeCheck(() => {
            ownWorkerCount = this.worldKnowledge.count(r => r.team === this.me.team && r.unit === SPECS.PILGRIM);
            ownArmyCount = this.worldKnowledge.count(r => r.team === this.me.team && r.unit > SPECS.PILGRIM);
            visibleArmyCount = this.getTruelyVisibleRobots().filter(r => r.team === this.me.team && r.unit > 2).length;
        }, "update global statistics", 2);

        // Find best global expansion
        const expansion = this.timeCheck(() => this.castleFindBestExpansion(), "castleFindBestExpansion");

        const rushFirstExpand = expansion != null
            && expansion.castleId === this.me.id 
            && !!expansion.offensive
            && ownArmyCount === 0
            && this.me.turn < 10
            && !!this._strats.RUSH_FIRST_EXPAND;

        // this.log("Want to rush first expand: " + rushFirstExpand);

        // Find best local mining spot
        const localMineTarget = this.timeCheck(() => this.structureFindBestClosestMiningSpot(), "structureFindBestClosestMiningSpot");

        // Reserves wanted to construct local miner
        // Required to save resources for rush defense
        // If strategy allows rushing reserve even more while negotiating
        const mayStillRush = this._strats.RUSH_MAX_CASTLES > 0 && this._wl_castle_state === CASTLE_STATE.NEGOTIATE_MASTER;

        const CASTLE_MINER_FUEL_RESERVE = 150;
        const CASTLE_MINER_KARB_RESERVE = mayStillRush ? 90 : this.getBaseKarboniteFloat();

        // If we have not saturated all local spots, do so
        if (!rushFirstExpand && localMineTarget && (ourFirstMiner || this.canBuild(SPECS.PILGRIM, CASTLE_MINER_KARB_RESERVE, CASTLE_MINER_FUEL_RESERVE))) {
            this.log("Trying to expand to best local mine target: " + JSON.stringify(localMineTarget));
            return this.timeCheck(() => this.structureBuildMiner(localMineTarget), "this.structureBuildMiner", 1);
        }         
        // If we are the one expanding, do so
        else if (expansion && expansion.castleId === this.me.id && this.canBuild(SPECS.CRUSADER, CASTLE_MINER_KARB_RESERVE, CASTLE_MINER_FUEL_RESERVE)) {
            // Query information about expanding
            const canExpandAgain = this.me.turn >= this._castle_next_expansion;

            if (canExpandAgain) {
                if (expansion.offensive) {
                    if (this._strats.MAX_ATTACK_TURN != null && this.me.turn <= this._strats.MAX_ATTACK_TURN) {
                        const action = this.castleExpandAgressively(expansion.expand, this._strats.EXPAND_QUEUE);
                        if (action) { 
                            this.log("Potentially agressively expanding to: " + JSON.stringify(expansion));
                            return action; 
                        }
                    }
                } else {
                    const action = this.structureBuildMiner([expansion.expand.x, expansion.expand.y], true);

                    if (action) {
                        this.castlePremarkExpandDangerous(expansion.expand);
                        this.log("Expanding to: " + JSON.stringify(expansion));
                        this._castle_next_expansion = Math.ceil(this.me.turn + this._struct_bfs_scores[expansion.expand.y][expansion.expand.x] / 10 + 4);
                        this.log("Next expansion: " + this._castle_next_expansion);
                        return action;
                    }
                }
            }
        }

        const isPrimaryAttacker = expansion && expansion.castleId === this.me.id;

        // Else perform optional idle build action
        const idleBuildAction = this.structureBuildIdleMilitary(isPrimaryAttacker);
        if (idleBuildAction) return idleBuildAction;

        // Idling, try safe expansion
        const canSafeExpandAgain = this._next_safe_expand <= this.me.turn;

        if (canSafeExpandAgain) {
            let safeExpand = this.castleFindBestExpansion(true /* safest */);

            // Safe expand if we have turn 50+
            if (safeExpand && safeExpand.castleId === this.me.id && this.me.turn >= 50) {
                // this.log("Safest expansion is :" + JSON.stringify(safeExpand));

                if (this.canBuild(SPECS.PILGRIM, this.getBaseKarboniteFloat() + 40, 500)) {
                    const action = this.structureBuildMiner([safeExpand.expand.x, safeExpand.expand.y], true);

                    if (action) {
                        // Mark as dangerous (will settle if worker arrives safely)
                        // TODO: Communicate?
                        this.castlePremarkExpandDangerous(safeExpand.expand);

                        if (this._strats.ALLOW_RAPID_SAFE_EXPAND) {
                            this._next_safe_expand = this.me.turn + 5;
                        } else {
                            this._next_safe_expand = Math.ceil(this.me.turn + this._struct_bfs_scores[safeExpand.expand.y][safeExpand.expand.x] / 10 + 4);
                        }

                        this.log("🏝️ Going for safe expansion at " + [safeExpand.expand.x, safeExpand.expand.y]);
                        return action;
                    }
                }
            }
        }

        // Otherwise, check charge
        this.structureCheckCharge();

        // If idling, trade
        return this.castleTrade();
    }

    castleTrade() {
        if (!this._strats.ENABLE_TRADING) return;

        // Idling, lets check incoming trade offers
        let offer_karbonite = this.last_offer[1- this.me.team][0];
        let offer_fuel = this.last_offer[1- this.me.team][1];

        var team = ((this.me.team == 0) ? 1 : -1); // 1: red -1: blue
        
        if(offer_karbonite * team < 0 && offer_fuel * team < 0){ // GIFT
                this.log("Thanks for the gift! 🎁") ;      
            return this.proposeTrade(offer_karbonite, offer_fuel);
        } else if (offer_karbonite * team  > 0 && offer_fuel * team > 0) { // SCAM 
            this.log("You can't scam us! 😡")
        } 

        if((Math.abs(offer_fuel) >= Math.abs(5 * offer_karbonite) && offer_karbonite * team >= 0) || (Math.abs(offer_fuel) <= Math.abs(5 * offer_karbonite) && offer_fuel * team >=0)){
                if(offer_karbonite * team > 0 && (this.karbonite - offer_karbonite) > 500 && offer_karbonite * team <= 10) { // accepting all trades with a 1K : 5F ratio -> FUEL > 1000 K > 500 after trade
                    this.log("It was a pleasure to trade with you! 😊");
                    return this.proposeTrade(offer_karbonite, offer_fuel);
                } else if(offer_fuel * team > 0 && (this.fuel - offer_fuel) > 1000 && offer_fuel * team <= 50){
                    this.log("It was a pleasure to trade with you! 😊");
                    return this.proposeTrade(offer_karbonite, offer_fuel);
                }  
        }
        // RED: abgeben = positiv
        // BLUE: abgeben = negativ
        
        // no (good) offers -> try to scam the enemy
        // 1 K -> 15 F
        // 2 F -> 1 K
        let sell_K = 1
        let buy_F = 15

        let sell_F = 2
        let buy_K = 1

        
        if(this.fuel > 1000) {
            // this.log("This has been the worst trade deal in the history of trade deals, maybe ever!");
            return this.proposeTrade(-1 * buy_K * team, sell_F * team);
        } else if (this.karbonite > 500) {
            // this.log("This has been the worst trade deal in the history of trade deals, maybe ever!");
            return this.proposeTrade(sell_K * team, -1 * buy_F * team);
        }
    }

    // ----------------------------------------------------------------------------------
    // Robot functions
    // ----------------------------------------------------------------------------------

    militaryOnTerminate(r) {
        if (r.team !== this.me.team && r.unit === SPECS.CASTLE) {
            // Hooray, enemy castle down
            this.log("🏰🏰🏰 Enemy castle (" + r.x + ", " + r.y + ") down, mlday");
        }
    }

    calculateDanger(robots) {
        let attackSum = 0;
        for (let i = 0; i < robots.length; ++i) {
            const robot = robots[i];
            let dangerFactor = 1;
            if (robot.unit === SPECS.PREACHER) {
                dangerFactor = 2;
            }
            attackSum -= dangerFactor * (SPECS.UNITS[robot.unit].STARTING_HP * SPECS.UNITS[robot.unit].ATTACK_DAMAGE);
        }
        return attackSum;
    }

    turnMilitary() {
        if (this.me.unit === SPECS.CRUSADER && this.me.x === 34 && this.me.y === 27) {
            this.log("Crusader turn!");
            this.log("---------------------------------------------------------");
            this.log("");
            this.log("");
        }

        this.militaryHandleRadio();

        const isAggressiveUnit = (this.me.unit === SPECS.CRUSADER || this.me.unit === SPECS.PREACHER)

        // aggressiveness:
        const heuristicNormalisationFactor = 0.8;
        const attackWeight = heuristicNormalisationFactor * (isAggressiveUnit ? 5.0 : 2.0);
        const receiveWeight = 1.0;
        const confidenceThreshold = isAggressiveUnit ? 0.0 : 2.0;

        // This may be too simple... possible alternative:
        // record history of fuel and karbonite deltas
        // estimate cost of attack
        // if delta negative and fuel under threshold then fuel starved

        const isFuelStarved = this.fuel < 500;

        const visibleRobots = this.getTruelyVisibleRobots();

        // If we are seeing the enemy castle, immediately order a charge
        const visibleEnemyCastles = visibleRobots.filter(r => r.team !== this.me.team && r.unit === SPECS.CASTLE);

        if (visibleEnemyCastles.length > 0) {
            this.log("⚔️ Enemy castle spotted, attempting charge");
            this.militaryLeadCharge(this.makeRelative(visibleEnemyCastles[0]));
        }

        // confidence is based on visible team members and visible enemies
        const visibleTeamAttackers =  visibleRobots.filter(r => r.team === this.me.team && r.unit > 2).length;
        const visibleEnemyAttackers = visibleRobots.filter(r => r.team !== this.me.team && r.unit > 2).length;
        let confidence = visibleTeamAttackers - visibleEnemyAttackers;
        confidence += -0.03*(SPECS.UNITS[this.me.unit].STARTING_HP - this.me.health)

        const isLowHealth = this.me.health / SPECS.UNITS[this.me.unit].STARTING_HP < 0.5; // less to 50% health
        const earlyGame = this.karbonite <= 120;
        const pilgrimInVision = this.findClosestVisiblePredicate(r => r.team !== this.me.team && r.unit === SPECS.PILGRIM)

        let dmgMap = this.calculateDamageMap();
        const [attackSquare, attackHeuristic] = this.findBestAttackSquareWithHeuristic();

        const defendableStructs = this.worldKnowledge.filter(r => {
            const dist = chebyshevDistance(this.me.x, this.me.y, r.x, r.y);
            return r.team === this.me.team 
                && r.unit < 2 
                && dist < 5;
        });

        let isOnBuildSpot = false
        for (let i = 0; i < defendableStructs.length; ++i) {
            if (chebyshevDistance(this.me.x, this.me.y, defendableStructs[i].x, defendableStructs[i].y) <= 1) {
                isOnBuildSpot = true;
            }
        }
         
        const isOnResource = this.fuel_map[this.me.y][this.me.x] || this.karbonite_map[this.me.y][this.me.x];
        const defendStructure = defendableStructs.length > 0;

        const closestEnemy = this.findClosestVisiblePredicate(r => r.team !== this.me.team && r.unit > 2);

        if (dmgMap === null && attackSquare) {
            // enemy Pilgrim nearby, attack
            return this.wrapAttack(...attackSquare);
        } else if (dmgMap === null && pilgrimInVision && earlyGame) {
            // hunt down that pilgrim...
            const [bestMove, damage] = this.findBestAggressiveMoveCombat([pilgrimInVision.x, pilgrimInVision.y], dmgMap);
            if (bestMove) {
                return this.move(...bestMove);
            } else if (!isOnResource && !isOnBuildSpot){
                return;
            }            
        } else if (dmgMap !== null) {
            // unit will may receive damage if attacked
            const maxDamageReceivedWhenAttacking = dmgMap[this.me.y][this.me.x];

            // Determine best dodge tile
            const [bestDodgeMove, damageAfterDodging] = this.findBestDodgeSpot(dmgMap);
        
            if (attackSquare) {
                const shouldAttack = (attackWeight*attackHeuristic - receiveWeight*maxDamageReceivedWhenAttacking > -damageAfterDodging) || confidence >= confidenceThreshold;
               
                if (maxDamageReceivedWhenAttacking === 0 ||
                    shouldAttack ||
                    bestDodgeMove === null ||
                    defendStructure) {
                        //attacking is beneficial
                        return this.wrapAttack(...attackSquare);
                } else {
                    // dodge
                    return this.move(...bestDodgeMove);
                }
            } else {

                if (this.me.unit === SPECS.PROPHET && maxDamageReceivedWhenAttacking > 0) {
                    // Archer is too close...
                    const [bestMove, damageAfterDodging] = this.findBestDodgeSpotPassive(dmgMap);
                    if (bestMove) {
                        return this.move(...bestMove);
                    } else {
                        // Prophet can not dodge and not attack, sad story...
                        return;
                    }
                }
                if (defendStructure && !isOnResource && !isOnBuildSpot && !isAggressiveUnit) {

                    // move away from resource tiles and away from build spots
                    // hold position to defend
                    return;
                }
                if (closestEnemy && isAggressiveUnit && !isFuelStarved && !isLowHealth) {
                    // Don't charge crusader 1 on 1 unless we have advantage
                    // Visible team attackers includes self
                    if (this.me.unit === SPECS.CRUSADER && closestEnemy.unit === SPECS.CRUSADER && visibleTeamAttackers <= 1) {
                        const lookup = this.worldKnowledge.findById(closestEnemy.id);

                        if (!lookup || lookup.damage == null || lookup.damage < SPECS.UNITS[this.me.unit].STARTING_HP - this.me.health) {
                            // Just hold still, okay, unless moving is really important
                            let idle = this.getIdleMove();
                            if (idle && idle.important) return idle.action;
                            else return;
                        }
                    } else if (this.me.unit === SPECS.CRUSADER && closestEnemy.unit === SPECS.PREACHER && visibleTeamAttackers <= 1) {
                        // Just hold still, okay, unless moving is really important
                        let idle = this.getIdleMove();
                        if (idle && idle.important) return idle.action;
                        else return;
                    }
                    const [bestMove, damage] = this.findBestAggressiveMoveCombat([closestEnemy.x, closestEnemy.y], dmgMap);
                    if (bestMove) {
                        return this.move(...bestMove);
                    }
                }
            }
        }

        const fw = this.getForwardDirection();
        if (this._took_damage && !closestEnemy && fw && this.me.unit === SPECS.CRUSADER) {
            // move in direction of forward vector
            const move = this.bestMoveInDirection(...fw);
            if (move) return this.move(...move)
        }

        // move to target
        if (this._military_state === MILITARY_STATE.HOLD) {
            // Try to hold a position 2 tiles away from any unit
            // But don't move if team is severely fuel starved
            let idle = this.getIdleMove();

            // If we have a good idle move and we are not fuel starved or
            // the move is important (free resource or build spot, move)
            if (idle && (this.fuel >= 300 || idle.important)) {
                return idle.action;
            }
        } else if (this._military_state === MILITARY_STATE.TARGET_MIRROR) {
            return this.navigatePath(this.mirror(this.homeStructure.x, this.homeStructure.y), NAV.FASTEST);
        } else if (this._military_state === MILITARY_STATE.TARGET_TARGETS) {
            // If seeing the current target, shift if visible
            let action = this.navigatePath(this._military_targets[0], NAV.FASTEST);

            if (action) return action;

            // If visible, but obstructed, stop navigation
            let t = this._military_targets[0];
            let map = this.getVisibleRobotMap();

            if (map[t[1]][t[0]] > 0) {
                this._military_targets = this._military_targets.slice(1);

                if (this._military_targets.length === 0) {
                    this.log("Kann nich malochen :/");
                    this._military_state = MILITARY_STATE.HOLD;
                    return;
                }
            }
        } else if (this._military_state === MILITARY_STATE.CHARGE) {
            // If stuck too long, fall back to holding
            if (this.me.turn >= this._military_charge_end_turn) {
                this._military_state = MILITARY_STATE.HOLD;
                this.log("⚔️ End of charge, holding position");
                return;
            }

            // Just charge in general direction
            const move = this.bestMoveInDirection(...this._military_charge_direction);
            if (move) return this.move(...move);
        }
    }

    turnPilgrim() {
        // Determine whether this is a karbonite miner
        const isKarboniteMiner = this._wl_target && this.karbonite_map[this._wl_target[1]][this._wl_target[0]];

        // Check state transitions
        switch (this._worker_state) {
            case WORKER_STATE.SCOUT:
                // No transitions
                break;
            case WORKER_STATE.MINE:
                // Determine if inventory of mined resource full
                const fullInventory = isKarboniteMiner
                    ? this.me.karbonite === SPECS.UNITS[this.me.unit].KARBONITE_CAPACITY
                    : this.me.fuel === SPECS.UNITS[this.me.unit].FUEL_CAPACITY;
                
                if (fullInventory) this._worker_state = WORKER_STATE.DROPOFF;
                break;
            case WORKER_STATE.DROPOFF:
                const inventoryClear = isKarboniteMiner
                    ? this.me.karbonite === 0
                    : this.me.fuel === 0;
                
                if (inventoryClear) this._worker_state = WORKER_STATE.MINE;
                break;
        }

        // Perform state tasks
        switch (this._worker_state) {
            case WORKER_STATE.SCOUT:
                return this.pilgrimScout();
            case WORKER_STATE.MINE:
            case WORKER_STATE.DROPOFF:
                return this.pilgrimMine();
            case WORKER_STATE.CONSTRUCT:
                return this.pilgrimConstruct();
        }
    }

    nextUnoccupiedResource() {
        let map = this.getResourceMap();
        let idMap = this.getVisibleRobotMap();

        let bestDist = Infinity;
        let best = null;

        const lowerX = Math.max(0, this.me.x - 10);
        const lowerY = Math.max(0, this.me.y - 10);
        const upperX = Math.min(this.map.length - 1, this.me.x + 10);
        const upperY = Math.min(this.map.length - 1, this.me.y + 10);

        for (let y = lowerY; y <= upperY; ++y) {
            for (let x = lowerX; x <= upperX; ++x) {
                // Take any free spot, if we are already on the spot also ok
                if (map[y][x] && (idMap[y][x] === 0 || idMap[y][x] === this.me.id)) {
                    let dist = schierDistance(this.me.x, this.me.y, x, y);

                    // Prefer karbonite
                    if (this.karbonite_map[y][x]) {
                        dist -= 3;
                    }

                    if (dist < bestDist) {
                        bestDist = dist;
                        best = [x, y];
                    }
                }
            }
        }

        return best;
    }

    /*
    * Executes this.move only if it is safe to do so. Otherwise dodge the enemy or dropoff resource to structure
    */
    moveIfSafe(move) {

        // When in combat, dodge the enemy.
        const damageMap = this.calculateDamageMap();
        if (damageMap && damageMap[this.me.y][this.me.x] > 0) {
            
            const [bestMove, damage] = this.findBestDodgeSpotPassive(damageMap)
            if (bestMove === null) {
                return;
            } else {
                return this.move(...bestMove);
            }
        } else if (move) {
            // Don't run into enemy attackers
            const newPosition = [this.me.x + move[0], this.me.y + move[1]];
            if (damageMap && damageMap[newPosition[1]][newPosition[0]] > 0) return;
            return this.move(...move);
        }
        return null;
    }

    bestMoveInDirection(dx, dy) {
        const allMoves = this.listPossibleMoves();

        let bestMove = null;
        let bestDot = 0; // Want to be better than 0, which is perpendicular

        for (let i = 0; i < allMoves.length; ++i) {
            const [mx, my] = allMoves[i];

            if (!this.truelyPassableDelta(mx, my)) continue;

            // Take unnormalized dot product to figure out which move furthest towards target direction
            const dot = mx * dx + my * dy;

            if (dot > bestDot) {
                bestDot = dot;
                bestMove = [mx, my];
            }
        }

        return bestMove;
    }

    repulse() {
        // Skunk mode active
        const canRepulseAgain = this._repulse_last_turn == null || this.me.turn - this._repulse_last_turn > 3;

        if (canRepulseAgain && this.radioSetEventMessage(RADIO_PRIO.REPULSE, encodeRadio({type:"repulse"}), 2)) {
            this.log("🤮 Repulsing close units");
            this._repulse_last_turn = this.me.turn;
        }
    }

    pilgremRetask() {
        this._worker_construct_target = null;
        this._worker_state = WORKER_STATE.MINE;
        this._wl_target = this.nextUnoccupiedResource();

        if (this._wl_target == null) {
            this.log("Get your kit and form up, promoted to scout");
            this._wl_target = this.mirror(this.me.x, this.me.y);
            this._worker_state = WORKER_STATE.SCOUT;
        }
    }

    pilgrimConstructFinish(x, y) {
        // Calculate delta and construct
        let dx = x - this.me.x;
        let dy = y - this.me.y;

        if (chebyshevDistance(0, 0, dx, dy) > 2) {
            throw Error("Construction spot out of reach");
        }

        if (this.canBuild(SPECS.CHURCH, this.getBaseKarboniteFloat(), 200)) {
            const botMap = this.getVisibleRobotMap();
            if (botMap[y][x] === 0) {
                this.log("👷 Praise the lord, now at " + [x, y]);
                this.pilgremRetask();
                return this.buildUnit(SPECS.CHURCH, dx, dy);
            } else {
                this.log("👷 Hard hats required, please clear the construction site: " + [x, y]);

                this.repulse();

                return;
            }
        } else {
            this.log("👷 Too broke for Jesus");
            return;
        }
    }

    pilgrimConstruct() {

        // dodge any damage
        const damageMap = this.calculateDamageMap();
        if (damageMap && damageMap[this.me.y][this.me.x] > 0) {
            const [bestMove, damage] = this.findBestDodgeSpotPassive(damageMap)
            if (bestMove === null) {
                this.log("I want to dodge but have no move :(");
                return;
            } else {
                return this.move(...bestMove); 
            }
        }

        if (!this._worker_construct_target) {
            // Trust castle placement
            this._worker_construct_target = this._wl_target.slice();

            this.log("👷 Planning a construction at: " + this._worker_construct_target);
            
            // List all absolute tiles in moore neighbourhood of construct target
            // to navigate there
            this._worker_construct_surround = this.listDeltaTiles(1, 2).map(dt => dt.zip(this._worker_construct_target, (a, b) => a + b));
        }

        // Abort construction if we see a structure too close to the target location
        const closeStruct = this.getTruelyVisibleRobots().findIndex(r => {
            return r.team === this.me.team 
                && r.unit < 2 
                && chebyshevDistance(...this._worker_construct_target, r.x, r.y) < MINIMUM_CHURCH_DISTANCE;
        }) >= 0;

        // Abort construction if the build tile is occupied by an enemy church
        const id = this.getVisibleRobotMap()[this._worker_construct_target[1]][this._worker_construct_target[0]];

        let occupied = false;

        if (id > 0) {
            let r = this.getRobot(id);
            if (r.team === 1 - this.me.team && r.unit < 2) occupied = true;
        }

        if (closeStruct || occupied) {
            // Clear order and switch state
            this.log("👷 Canceling construction, close structure to " + this._worker_construct_target);
            this.pilgremRetask();
            return;
        }

        // No close church, check for emergency church
        const enemyUnits = this.countVision(1 - this.me.team);
        const friendlyUnits = this.countVision(this.me.team);

        const enemyCombat = enemyUnits[SPECS.CRUSADER] + enemyUnits[SPECS.PREACHER] + enemyUnits[SPECS.PROPHET];
        const friendlyCombat = friendlyUnits[SPECS.CRUSADER] + friendlyUnits[SPECS.PREACHER] + friendlyUnits[SPECS.PROPHET];

        if (enemyCombat > 0 && enemyCombat >= friendlyCombat && enemyCombat - friendlyCombat <= 2 && this._strats.MINIMUM_EMERGENCY_CHURCH_SCORE != null) {
            // Allow emergency church construction if no close structure
            const closestStructure = this.findClosestVisiblePredicate(r => r.team === this.me.team && r.unit < 2);

            if (!closestStructure || chebyshevDistance(closestStructure.x, closestStructure.y, this.me.x, this.me.y) > MINIMUM_CHURCH_DISTANCE) {
                if (this.canBuild(SPECS.CHURCH)) {
                    let tvmap = this.generateTrueVisionPassableMap();

                    // Can't build on self
                    tvmap[this.me.y][this.me.x] = false;

                    let obj = this.findBestConstructSpotWithScore(this.me.x, this.me.y, this.getForwardDirection(), 1, tvmap);

                    if (obj && obj.score >= this._strats.MINIMUM_EMERGENCY_CHURCH_SCORE) {
                        this.log("👷 Trying to build emergency church at " + [obj.x, obj.y]);
                        return this.pilgrimConstructFinish(obj.x, obj.y);
                    }
                }
            }
        }

        // Check if we are on a surrounding tile
        const onSpot = this._worker_construct_surround.findIndex(e => e[0] === this.me.x && e[1] === this.me.y) >= 0;

        if (onSpot) {
            return this.pilgrimConstructFinish(...this._worker_construct_target);
        }

        let act = this.timeCheck(() => this.navigationMove(this._worker_construct_surround, NAV.FASTEST), "this.navigationMove", 2);

        if (!act) {
            this.log("👷 cannot reach target: " + this._worker_construct_target);
        }

        return this.timeCheck(() => this.moveIfSafe(act), "this.moveIfSafe", 2);
    }

    pilgrimMine() {

        // home was destroyed, please donate...
        let structs = this.worldKnowledge.filter(r => r.team === this.me.team && r.unit < 2);
        if (structs.length === 0) {
            this._worker_state = WORKER_STATE.SCOUT;
            return;
        }
        
        const dropoffTiles = this.listDropoffTiles(structs);
        const damageMap = this.calculateDamageMap();

        if (damageMap && damageMap[this.me.y][this.me.x] > 0) {
            const [bestMove, damage] = this.findBestDodgeSpotPassive(damageMap)
            if (bestMove === null) {
                this.log("I want to dodge but have no move :(");
                return;
            } else {
                return this.move(...bestMove); 
            }
        }

        // Determine mined ressource based on target tile
        const isKarboniteMiner = this.karbonite_map[this._wl_target[1]][this._wl_target[0]];

        // If not fully stocked on karbonite, move to mine
        if (this._worker_state === WORKER_STATE.MINE) {
            // If on correct tile, mine
            if ((isKarboniteMiner && this.karbonite_map[this.me.y][this.me.x]) || (!isKarboniteMiner && this.fuel_map[this.me.y][this.me.x])) {
                return this.mine();
            } else {
                // Navigate to target
                const navMove = this.navigationMove(this._wl_target, this._worker_nav_mode);
                return this.moveIfSafe(navMove);
            }
        } 
        // Else move to drop-off
        else {

            const navMove = this.navigationMove(dropoffTiles, this._worker_nav_mode);

            if (navMove) {
                // Don't run into enemy attackers
                const newPosition = [this.me.x + navMove[0], this.me.y + navMove[1]];
                if (damageMap && damageMap[newPosition[1]][newPosition[0]] > 0) return;
        
                let action = this.move(...navMove);

                // If no action available on drop-off tile (or cannot navigate but w/e)
                if (action) return action;
            }

            // Drop off closest
            const closest = structs.fnMin(s => chebyshevDistance(s.x, s.y, this.me.x, this.me.y));

            const delta = [closest.x - this.me.x, closest.y - this.me.y];

            if (delta[0] * delta[0] + delta[1] * delta[1] <= 2) {
                return this.give(delta[0], delta[1], this.me.karbonite, this.me.fuel);
            } else {
                this.repulse();
                this.log("I am so blocked")
            }
        } 
    }


    pilgrimScout() {
        let canInform = false;
        
        const enemyReport = new Array(SPECS.UNITS.length).fill(0);
        const directions = new Array(16).fill(0);

        const lastSeenEnemies = this.worldKnowledge.filter(r => r.team !== this.me.team &&
                                                                this.me.turn - r.posUpdateTurn < 5 &&
                                                                (r.lastReportedTurn == null || this.me.turn - r.lastReportedTurn > 5));
        for (let i = 0; i < lastSeenEnemies.length; ++i) {
            const enemy = lastSeenEnemies[i];
            if ((enemy.unit === SPECS.CHURCH || enemy.unit > 2) && enemyReport[enemy.unit] < 3) { 
                enemyReport[enemy.unit] += 1;
                enemy.lastReportedTurn = this.me.turn;

                // calculate direction of enemy
                const [dx, dy] = this.makeRelative(enemy.x, enemy.y);
                const angle = Math.atan2(dy, dx);
                const quantifiedAngle = Math.round(angle / (Math.PI / 8)) % 16;
                directions[quantifiedAngle] += 1;
                canInform = true;
            }
        }
        // TODO: Determine if update bit should be sent...
        const msg = {
            type: "scout",
            update: 0,
            churches: enemyReport[SPECS.CHURCH],
            crusaders: enemyReport[SPECS.CRUSADER],
            prophets: enemyReport[SPECS.PROPHET],
            preachers: enemyReport[SPECS.PREACHER],
            direction: directions.argmax()
        };

        let structs = this.worldKnowledge.filter(r => r.team === this.me.team && r.unit === SPECS.CASTLE);
        if (structs.length !== 0) {
            const closest = structs.fnMin(s => chebyshevDistance(s.x, s.y, this.me.x, this.me.y));
            const radiusSq = Math.pow(closest.x - this.me.x, 2) + Math.pow(closest.y - this.me.y, 2);
            //this.log("closest : " + JSON.stringify(closest));

            if (canInform) {
                // Don't scout for now
                // this.radioSetEventMessage(RADIO_PRIO.SCOUT, encodeRadio(msg), radiusSq);
                // this.log("send radio in r2: " + radiusSq + " - " + JSON.stringify(msg));
            }
        }

        // move or dodge
        const damageMap = this.calculateDamageMap();

        if (damageMap !== null) {
            if (damageMap[this.me.y][this.me.x] > 0) {
                // I am in danger!
                const [dodgeMove, _] = this.findBestDodgeSpotPassive(damageMap);
                if (dodgeMove === null) {
                    return;
                } else {
                    return this.move(...dodgeMove);
                }
            } else {
                // enemies nearby, move sneakily to avoid moving into their attack range and spy on them
                const proposedMove = this.navigationMove(this._wl_target, NAV.ECONOMIC);
                if (proposedMove === null) return
                const pos = [this.me.x + proposedMove[0], this.me.y + proposedMove[1]];
                if (damageMap[pos[1]][pos[0]] > 0) {
                    // would move in attack range
                    return;
                } else {
                    return this.move(...proposedMove);
                }
            }

        } else {
            // cover ground, nothing to fear
            return this.navigatePath(this._wl_target, NAV.FASTEST);
        }
    }

    turnRobotSpecific() {
        if (this.me.unit === SPECS.CASTLE) {
            return this.turnCastleBase();
        } else if (this.me.unit === SPECS.CHURCH) {
            return this.turnChurch();
        } else if (this.isRobot()) {
            if (this.me.unit === SPECS.PILGRIM) {
                return this.turnPilgrim();
            } else {
                return this.turnMilitary();
            }
        }
    }

    turn() {

        this._util_frozen = this.me.turn !== 1 && this._util_last_ok_turn !== this.me.turn - 1;

        if (!COMPETITION_MODE && this._util_frozen) {
            this._util_last_ok_turn = this.me.turn;
            this.log("I was frozen last turn");
            return;
        }

        if (this.me.turn === 1) {
            // Overwrite default logger with more detailed one, or completely remove logging in competition
            if (COMPETITION_MODE) {
                this.log = () => {};
            } else {
                const logger = this.log.bind(this);
                this.log = (msg) => logger(this.formatUnit() + "@" + this.me.x + "x" + this.me.y + "T" + this.me.turn + ": " + msg);
            }

            // Initialize world knowledge
            this.worldKnowledge = new WorldKnowledge(this.log);
            this._last_turn_health = this.me.health;
            this._took_damage = false;

            // Execute first turn handler
            this.onBirth();
        } else {
            if (this._last_turn_health !== this.me.health) {
                this._last_turn_health = this.me.health;
                this._took_damage = true;
            } else {
                this._took_damage = false;
            }
        }

        // For any bot, update world knowledge by vision
        this.worldKnowledge.updateFromPerception(this);

        // If structure, update structure statistics and lattice
        if (this.me.unit < 2) {
            this.structureUpdateMiningUtilization();
            this._lattice.updateTick();
        }

        // Execute the actual unit logic
        const action = this.turnRobotSpecific();

        // Set castle talk position message, will be send if no more important pending message
        this.castleTalkSetEventMessage(CASTLETALK_PRIO.POSITION, castleTalkMessage("position", [this.me.x, this.me.y], this.map.length));

        // Set alert messages if appropriate
        const canReportAgain = this._wl_alert_last_turn == null || this.me.turn - this._wl_alert_last_turn >= 4;

        if (canReportAgain) {
            const closestEnemy = this.findClosestVisiblePredicate(r => r.team === 1 - this.me.team && r.unit !== SPECS.PILGRIM);

            if (closestEnemy) {
                const angle = quantifyDirection(closestEnemy.x - this.me.x, closestEnemy.y - this.me.y);
                if (this.castleTalkSetEventMessage(CASTLETALK_PRIO.ALERT, castleTalkMessage("alert", angle))) {
                    this._wl_alert_last_turn = this.me.turn;
                }
            }
        }

        // Send pending radio messages
        this.castleTalkSendMessage();
        this.radioSendMessage();

        this._util_last_ok_turn = this.me.turn;

        return action;
    }

    /**
     * Find a path from the specified start tile to the end tile. 
     * Path is a list of [x, y] elements including start and end tile. Local vision of robot
     * is taken into account when calculating the path. If no path exists, null is returned.
     * @param {*} targets [x, y] absolute target or list of targets in form [[x, y], [x, y], ...]
     * @param {number} mode Navigation mode, defaults to NAV.ECONOMIC
     * @param {*} start Start tile of path in format [x, y], if unspecified use current location
     */
    findPath(targets, mode, start, flags) {
        mode = mode || NAV.ECONOMIC;
        flags = flags || {};

        const mappingMode = !!flags.map;
        const unit = flags.unit || this.me.unit;

        if (mode === NAV.ECONOMIC) {
            var fuelFactor = 10;
            var timeFactor = 1;
        } else {
            var fuelFactor = 1;
            var timeFactor = 10;
        }

        if (start === undefined) start = [this.me.x, this.me.y];

        // If target 1d array, convert to 2d array
        if (!Array.isArray(targets[0])) targets = [targets];

        // In mapping mode, no targets
        if (mappingMode) targets = [];

        // In mapping mode, ignore present units
        const tvmap = mappingMode
            ? this.getPassableMap()
            : (flags.tvmap || this.generateTrueVisionPassableMap());

        // Fail fast if no target passable to safe-guard against clock exhaustion
        let hasPassableTarget = false;

        for (let i = 0; i < targets.length; ++i) {
            if (this.truelyPassableAbsolute(...targets[i], tvmap)) {
                hasPassableTarget = true;
                break;
            }
        }

        if (!hasPassableTarget && !mappingMode) {
            return null;
        }

        // Manhattan distance to closest target, unless BFS mapping
        const heuristic = mappingMode
            ? (pos) => 0
            : (pos) => 
        {
            let best = Infinity;
            for (let i = 0; i < targets.length; ++i) {
                const score = Math.abs(pos[0] - targets[i][0]) + Math.abs(pos[1] - targets[i][1]);
                if (best > score) best = score;
            }
            return best;
        }

        // Get delta action list
        const deltaActions = this.listPossibleMoves(unit);//.filter(a => a[0] * a[0] + a[1] * a[1] < 3);

        // Create new frontier, sort by smallest cost
        let frontier = new PriorityQueue((x, y) => x.cost - y.cost);

        // Create 2D Grids
        let closedSet = Array.filled2D(this.map.length, this.map[0].length, false);
        let cameFrom  = Array.filled2D(this.map.length, this.map[0].length, null);
        let gScore    = Array.filled2D(this.map.length, this.map[0].length, Infinity);

        // Enqueue initial element
        frontier.enqueue({
            cost: 0,
            elem: start,
            came_from: null
        });

        gScore[start[1]][start[0]] = 0;

        // Look up constants
        const FUEL_PER_MOVE = SPECS.UNITS[this.me.unit].FUEL_PER_MOVE

        // While frontier is not empty
        while(frontier.count() > 0) {

            // Grab the lowest f(x) to process next. Heap keeps this sorted for us.
            let current = frontier.dequeue();

            const currentX = current.elem[0];
            const currentY = current.elem[1];

            // Ignore if already closed
            if (closedSet[currentY][currentX]) {
                continue;
            }

            // Mark as closed and set came from
            closedSet[currentY][currentX] = true;
            cameFrom[currentY][currentX] = current.came_from;

            // Check if any of the targets reached
            if (!mappingMode) {
                let onTarget = false;

                for (let i = 0; i < targets.length; ++i) {
                    if (currentX === targets[i][0] && currentY === targets[i][1]) {
                        onTarget = true;
                        break;
                    }
                }

                // Goal reached, reconstruct path
                if (onTarget) {
                    let curr = current.elem;
                    let ret = [];
                    while (curr) {
                        ret.push(curr);
                        curr = cameFrom[curr[1]][curr[0]];
                    }

                    return ret.reverse();
                }
            }

            // Loop over available actions
            for (let actionIndex = 0; actionIndex < deltaActions.length; ++actionIndex) {

                const action = deltaActions[actionIndex];
                const fuelCost = FUEL_PER_MOVE * (action[0] * action[0] + action[1] * action[1]);

                const totalActionCost = fuelCost * fuelFactor + 1 * timeFactor;

                const newX = currentX + action[0];
                const newY = currentY + action[1];

                // Skip unpassable tiles
                if (!this.truelyPassableAbsolute(newX, newY, tvmap)) {
                    continue;
                }

                // Skip neighbour if already closed
                if (closedSet[newY][newX]) {
                    continue;
                }

                const tentativeGScore = gScore[currentY][currentX] + totalActionCost;
                
                if (tentativeGScore < gScore[newY][newX]) {
                    gScore[newY][newX] = tentativeGScore;

                    let expectedTotalCost = tentativeGScore + heuristic([newX, newY]);
                    frontier.enqueue({
                        cost: expectedTotalCost,
                        elem: [newX, newY],
                        came_from: [currentX, currentY]
                    });

                }
            }
        }

        // If mapping mode, return score map
        if (mappingMode) return gScore;

        // No result was found
        return null;
    }
}

var robot = new MyRobot();
