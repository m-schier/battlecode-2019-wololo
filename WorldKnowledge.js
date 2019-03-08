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

import {SPECS} from 'battlecode';

export class WorldKnowledge {
    constructor(logger) {
        // Dictionary of all known bots by id
        this._util_known_bots = {};

        // List of all known structures, will be checked each turn
        // to see if structure still exists, since structures can't
        // move easy to do. Only holds structure for which the
        // position was reported.
        this._util_known_structures = [];
        
        // Callbacks
        this._util_wk_terminate_cb = () => {};
        this._util_wk_initial_cb = () => {};

        this._logger = logger;

    }

    log(msg) {
        if (this._logger) this._logger(msg);
    }

    /**
     * Apply damage to a known bot
     * @param {number} id ID of bot to update
     * @param {number} damage damage dealth
     */
    applyDamage(id, damage) {
        let bot = this._util_known_bots[id];

        if (!bot) {
            throw Error("This bot is not known");
        }
        // update health
        if('damage' in bot){
            bot.damage += damage;
        } else {
            bot.damage = damage;
        }
    }

    /**
     * Count all units matching the given predicate,
     * faster than listing them.
     * @param {function} predicate 
     */
    count(predicate) {
        let count = 0;
        let robots = Object.values(this._util_known_bots);
        for (let i = 0; i < robots.length; ++i) {
            if (predicate(robots[i])) ++count;
        }
        return count;
    }

    /**
     * Filter all known robots with the given predicate
     * @param {function} predicate 
     */
    filter(predicate) {
        return Object.values(this._util_known_bots).filter(predicate);
    }

    list() {
        return Object.values(this._util_known_bots);
    }

    /**
     * Set the team and unit type for the given robot.
     * Has no effect on multiple calls for same id.
     * Error to call on same ID with different teams and units.
     * @param {number} id 
     * @param {number} team 
     * @param {number} unit 
     * @param {boolean} trueVision Whether this is a true vision sighting. Allows reclassification
     */
    initialSighting(id, team, unit, trueVision) {
        trueVision = trueVision || false;

        let error = false;

        if (this._util_known_bots[id] !== undefined) {
            if (this._util_known_bots[id].team !== team) {
                error = true;
                this.log("🛑 Trying to change team of already known bot [" + id + "] from " + this._util_known_bots[id].team + " to " + team);
            } else if (this._util_known_bots[id].unit !== unit) {
                error = true;
                this.log("🛑 Trying to change unit type of already known bot [" + id + "] from " + this._util_known_bots[id].unit + " to " + unit);
            } 

            // If no error nothing to do, just return
            if (!error) return;
        }

        if (error) {
            if (!trueVision) return;
            else this.log("🛑 Changing unit base information because of true vision");
        }
        
        this._util_known_bots[id] = {
            id: id,
            team: team,
            unit: unit
        };

        this._util_wk_initial_cb(this._util_known_bots[id]);
    }

    /**
     * Find the bot by ID, return undefined if not found
     * @param {number} id 
     */
    findById(id) {
        return this._util_known_bots[id];
    }

    /**
     * Terminate the given robot
     * @param {number} id 
     */
    markTerminated(id) {
        let bot = this._util_known_bots[id];

        if (!bot) {
            throw Error("This bot is not known");
        }

        // For structures, also remove from known
        // structures list
        if (bot.unit < 2) {
            let structs = this._util_known_structures;

            // Find by linear search
            let i;
            for (i = 0; i < structs.length; ++i) {
                if (structs[i].id === id) break;
            }

            if (i !== structs.length) {
                // Note: Not finding the structure is not an error, the list
                // only contains structures for which the position is also
                // known.
                // Swap and pop to remove
                structs[i] = structs[structs.length - 1];
                structs.pop();
            }
        }

        // Remove from dictionary
        delete this._util_known_bots[id];

        // Finally invoke callback
        this._util_wk_terminate_cb(bot);
    }

    /**
     * Convenience function that sights and updates the position of the given robot object
     * @param {object} r Robot object
     * @param {number} turn Turn number
     */
    updateBot(r, turn, trueVision) {
        this.initialSighting(r.id, r.team, r.unit, trueVision);
        this.updatePosition(r.id, r.x, r.y, turn, trueVision);
    }

    /**
     * Update the knowledge of the world in general
     */
    updateFromPerception(owner) {
        const bots = owner.getVisibleRobots();
        const botMap = owner.getVisibleRobotMap();

        const reportedIds = {};

        for (let i = 0; i < bots.length; ++i) {
            // In any case keep track that we saw this id,
            // useful for castles
            reportedIds[bots[i].id] = true;

            // If visible update full, else if radioing just triangulate
            if (owner.isVisible(bots[i])) {
                this.updateBot(bots[i], owner.me.turn, true /* true vision */);
            } else if (owner.isRadioing(bots[i])) {
                this.updatePosition(bots[i].id, bots[i].x, bots[i].y, owner.me.turn);
            }
        }

        // Check vision radius for known structures, mark terminated
        // any structure that we should see but do not
        for (let i = 0; i < this._util_known_structures.length; ++i) {
            const s = this._util_known_structures[i];

            const idAtTile = botMap[s.y][s.x];

            if (idAtTile >= 0 && idAtTile !== s.id) {
                this.markTerminated(s.id);
                // Important: Due to the way we remove from the list, recheck index
                --i;
            }
        }

        // If we are a castle, ensure that everyone expected reported in
        if (owner.me.unit === SPECS.CASTLE) {
            const known = Object.values(this._util_known_bots);

            for (let i = 0; i < known.length; ++i) {
                if (known[i].team === owner.me.team && !reportedIds[known[i].id]) {
                    this.markTerminated(known[i].id);
                }
            }
        }
    }

    /**
     * Update the position of a known bot, no effect if not sighted
     * @param {number} id ID of bot to update
     * @param {number} x New x coordinate
     * @param {number} y New y coordinate
     * @param {number} turn Turn number of observation
     */
    updatePosition(id, x, y, turn, trueVision) {
        if (turn == null) {
            throw Error("No turn specified");
        }

        let bot = this._util_known_bots[id];

        if (!bot) {
            // No longer an error to update the position of an unknown
            // unit since radio triangulation is a thing, just ignore
            return;
        }

        // Ignore if update outdated
        if (bot.posUpdateTurn != null && bot.posUpdateTurn >= turn) {
            return;
        }

        // For structures, handle specially, take care that position is not
        // modified and 
        if (bot.unit < 2) {
            if (bot.x != null) {
                // Ensure we are not moving structures
                if (bot.x !== x || bot.y !== y) {
                    this.log("🛑 Trying to update position of static structure, type " + bot.unit + " from " + [bot.x, bot.y] + " to " + [x, y]);

                    // TODO
                    this.log("🛑 Cannot currently recover from this error");
                    return;
                }
            } else {
                // First position update for this structure, add to list
                // of known structure positions
                this._util_known_structures.push(bot);
            }
        }

        // In any case, update position
        bot.x = x;
        bot.y = y;
        bot.posUpdateTurn = turn;
    }

    setInitialSightingCallback(cb) {
        this._util_wk_initial_cb = cb;
    }

    setTerminateCallback(cb) {
        this._util_wk_terminate_cb = cb;
    }
}