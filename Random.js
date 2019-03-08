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

export function choice(arr) {
    return arr[Math.floor(Math.random() * arr.length)];
}

export function weightedChoice(arr, weights) {
    let sum = 0;

    for (let i = 0; i < arr.length; ++i) {
        sum += weights[i];
    }

    let want = Math.random() * sum;

    sum = 0;

    for (let i = 0; i < arr.length; ++i) {
        sum += weights[i];

        if (sum >= want) {
            return arr[i];
        }
    }
}