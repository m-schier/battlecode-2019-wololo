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

const GRIDS = 8;

const SCORE_CASTLE = 8;

const DANGER_THRESHOLD = 0.1;
const DANGER_DECAY = 0.99;

export class Strategy {
    constructor (mapSize, logger) {
        this._logger = logger;
        this._enemy_castles = [];
        this._enemy_churches = [];
        this._mapSize = mapSize;
        this._ownCivilScore = Array.filled2D(GRIDS, GRIDS, 0);
        this._ownCombatScore = Array.filled2D(GRIDS, GRIDS, 0);
        this._enemyCombatScore = Array.filled2D(GRIDS, GRIDS, 0);
        this._dangerScore = Array.filled2D(GRIDS, GRIDS, 0);
    }

    log(msg) {
        if (this._logger) this._logger(msg);
    }

    decayTick() {
        // Add to enemy combat score for every enemy castle
        for (let i = 0; i < this._enemy_castles.length; ++i) {
            const [x, y] = this.toGrid(...this._enemy_castles[i]);
            this._enemyCombatScore[y][x] += SCORE_CASTLE;
        }

        for (let x = 0; x < GRIDS; ++x) {
            for (let y = 0; y < GRIDS; ++y) {
                this._ownCivilScore[y][x] *= 0.5;
                this._ownCombatScore[y][x] *= 0.5;
                this._enemyCombatScore[y][x] *= 0.5;
                this._dangerScore[y][x] *= DANGER_DECAY;
            }
        }
    }

    findDefendGrid() {
        let grid = null;
        let worstScore = -Infinity;

        for (let x = 0; x < GRIDS; ++x) {
            for (let y = 0; y < GRIDS; ++y) {
                const score = this._ownCivilScore[y][x] - this._ownCombatScore[y][x];

                if (score > worstScore) {
                    worstScore = score;
                    grid = [x, y];
                }
            }
        }

        return grid;
    }

    markForwardDangerous(forward, threshold) {
        threshold = (threshold == null) ? -0.3 : threshold;

        // Want initial danger to wear off after 60 turns
        const INITIAL_FORWARD_DANGER = DANGER_THRESHOLD / Math.pow(DANGER_DECAY, 60);

        const half = (GRIDS - 1) / 2;

        for (let gy = 0; gy < GRIDS; ++gy) {
            for (let gx = 0; gx < GRIDS; ++gx) {
                const isForward = ((gx - half) * forward[0] + (gy - half) * forward[1]) / half > threshold;
                if (isForward) {
                    this._dangerScore[gy][gx] = Math.max(INITIAL_FORWARD_DANGER, this._dangerScore[gy][gx]);
                }
            }
        }
    }

    getDanger(x, y) {
        const [gx, gy] = this.toGrid(x, y);
        return this._dangerScore[gy][gx];
    }

    isDangerous(x, y) {
        return this.getDanger(x, y) > DANGER_THRESHOLD;
    }

    onUnitDied(r) {
        if (r.x != null) {
            this.markDangerous(r.x, r.y);
        }
    }

    markDangerous(x, y, direct, neighbours) {
        direct = direct || 1;
        neighbours = neighbours || 0.5;

        const [gx, gy] = this.toGrid(x, y);

        // Increase danger rating in moore neighbourhood
        const xMin = Math.max(0, gx - 1);
        const xMax = Math.min(GRIDS - 1, gx + 1);
        const yMin = Math.max(0, gy - 1);
        const yMax = Math.min(GRIDS - 1, gy + 1);

        for (let mx = xMin; mx <= xMax; ++mx) {
            for (let my = yMin; my <= yMax; ++my) {
                this._dangerScore[my][mx] += neighbours;
            }
        }
        this._dangerScore[gy][gx] += direct;
    }


    updateFriendly(r) {
        if (r.x != null) {
            // TODO: Debug this error
            try {
                const [gx, gy] = this.toGrid(r.x, r.y);

                if (r.unit === SPECS.CASTLE) {
                    this._ownCombatScore[gy][gx] += SCORE_CASTLE;
                } else if (r.unit === SPECS.CHURCH) {
                    this._ownCivilScore[gy][gx] += 5;
                } else if (r.unit === SPECS.PILGRIM) {
                    this._ownCivilScore[gy][gx] += 1;
                } else {
                    this._ownCombatScore[gy][gx] += 1;
                }
                
                this._dangerScore[gy][gx] *= 0.5;

            } catch (e) {
                this.log("🗺️ Failed to update " + JSON.stringify(r) + ": " + e);
                debugger;
            }
        }
    }

    toGrid(x, y) {
        x = x < 0 ? 0 : (x >= this._mapSize ? this._mapSize - 1 : x);
        y = y < 0 ? 0 : (y >= this._mapSize ? this._mapSize - 1 : y);

        return [Math.floor(x * GRIDS / this._mapSize), Math.floor(y * GRIDS / this._mapSize)];
    }

    gridCenter(gx, gy) {
        return [
            Math.floor((gx + 0.5) / GRIDS * this._mapSize),
            Math.floor((gy + 0.5) / GRIDS * this._mapSize)
        ]
    }

    getEnemyCastles() {
        return this._enemy_castles.slice(0);
    }

    initializeEnemyCastles(castles) {
        this._enemy_castles = castles;
    }

    isThreatenedByEnemyCastle(x, y) {
        for (let i = 0; i < this._enemy_castles.length; ++i) {
            const dx = x - this._enemy_castles[i][0];
            const dy = y - this._enemy_castles[i][1];

            if (dx * dx + dy * dy <= 13 * 13) {
                return true;
            }
        }

        return false;
    }
}