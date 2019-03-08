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

import * as EXT from 'Extensions.js';
import {SPECS} from 'battlecode';

export class Lattice {
    constructor(owner) {
        this._owner = owner;
        this._available = Array.filled2D(owner.map.length, owner.map.length, false);
        this._pulses = Array.filled2D(owner.map.length, owner.map.length, 0);
        this._initialized = false;
        // If far in enemy territory, build circular
        this._circular = owner.calculateOffensiveness() >= 0.5;
    }

    /**
     * Find the best available lattice spot
     * @param {number} maxDistSq Maximum squared eucliden distance from build spot to consider
     */
    findBest(maxDistSq) {
        let target = null;
        let bestScore = -Infinity;

        let forward = this._owner.getForwardDirection();

        // May seem over optimized
        // But was kinda a slug
        let forwardX = forward ? forward[0] : 0;
        let forwardY = forward ? forward[1] : 1;

        let my_x = this._owner.me.x;
        let my_y = this._owner.me.y;

        const maxDist = maxDistSq ? Math.ceil(Math.sqrt(maxDistSq)) : maxDistSq;

        const lowerX = maxDist
            ? Math.max(0, this._owner.me.x - maxDist)
            : 0;
        const lowerY = maxDist
            ? Math.max(0, this._owner.me.y - maxDist)
            : 0;
        const upperX = maxDist
            ? Math.min(this._owner.map.length - 1, this._owner.me.x + maxDist)
            : this._owner.map.length - 1;
        const upperY = maxDist
            ? Math.min(this._owner.map.length - 1, this._owner.me.y + maxDist)
            : this._owner.map.length - 1;

        const available = this._available;
        const pulses = this._pulses;
        const navScore = this._navScore;
        const circular = this._circular;

        for (let y = lowerY; y <= upperY; ++y) {
            for (let x = lowerX; x <= upperX; ++x) {
                if (!available[y][x]) continue;

                if (pulses[y][x] > 2) continue;

                const dx = x - my_x, dy = y - my_y;

                // If range limited, check range
                if (maxDistSq && (dx * dx + dy * dy) > maxDistSq) continue;

                //let score = 1 / (dx * dx + dy * dy);

                let score = 1 / navScore[y][x];

                if (!circular) {
                    score *= (1 + (forwardX * dx + forwardY * dy) / 20);
                }

                // If dense spot, decrease score
                if (!!(x & 1) !== !!(y & 1)) {
                    score *= 0.6;
                }

                if (score > bestScore) {
                    bestScore = score;
                    target = [x, y];
                }
            }
        }

        return target;
    }

    initialize(navScore, dense) {
        if (this._initialized) return;

        dense = dense || false;

        // Just lattice on all tiles where x mod 2 === y mod 2

        for (let y = 0; y < this._owner.map.length; ++y) {
            for (let x = 0; x < this._owner.map.length; ++x) {
                if (dense) {
                    this._available[y][x] = !!(x & 1) || !(y & 1);
                } else {
                    this._available[y][x] = !!(x & 1) == !!(y & 1);
                }

                // Not available if blocking resource
                if (this._owner.karbonite_map[y][x] || this._owner.fuel_map[y][x]) {
                    this._available[y][x] = false;
                }

                // Not available if blocked
                if (!this._owner.map[y][x]) this._available[y][x] = false;
            }
        }

        this._navScore = navScore;
        this._dense = dense;

        this._initialized = true;
    }

    // TODO Unregister
    registerStructure(x, y) {
        // Make everything in moore neighbourhood unavailable

        for (let dy = -1; dy <= 1; ++dy) {
            for (let dx = -1; dx <= 1; ++dx) {
                let mx = x + dx, my = y + dy;

                if (mx < 0 || my < 0 || mx >= this._owner.map.length || my >= this._owner.map.length) continue;

                this._available[my][mx] = false;
            }
        }
    }

    strongPulse(x, y) {
        this._pulses[y][x] += 100;
    }

    /**
     * To be invoked after world knowledge updated
     */
    updateTick() {
        const bots = this._owner.worldKnowledge.list();

        for (let i = 0; i < bots.length; ++i) {
            const b = bots[i];
            try {
                if (b.team === this._owner.me.team && b.posUpdateTurn != null && this._owner.me.turn - b.posUpdateTurn <= 5) {
                    this._pulses[b.y][b.x] += 1;
                }
            } catch (e) {
                this._owner.log("LATTICE: Error updating: " + JSON.stringify(b) + ": " + e);
            }
        }

        // Decrease all other pulses
        for (let y = 0; y < this._owner.map.length; ++y) {
            for (let x = 0; x < this._owner.map.length; ++x) {
                this._pulses[y][x] *= 0.95;
            }
        }
    }
}