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

Array.prototype.count = function arrayCount(filter) {
    let count = 0;
    for (let i = 0; i < this.length; ++i) {
        if (filter(this[i])) ++count;
    }
    return count;
}

Array.prototype.sum = function arraySum() {
    let sum = 0;

    for (let i = 0; i < this.length; ++i) {
        sum += this[i];
    }

    return sum;
}

/**
 * Copy a two dimensional array. Element copies are shallow.
 * @param {array} arr 2D array to be copied
 */
Array.copied2D = function arrayCopied2D(arr) {
    let root = new Array(arr.length);

    for (let x = 0; x < arr.length; ++x) {
        root[x] = arr[x].slice(0);
    }

    return root;
}

Array.empty2D = function arrayEmpty2D(i, j) {
    let root = new Array(i);
    let copy = new Array(j);

    for (let x = 0; x < root.length; ++x) {
        root[x] = copy.slice(0);
    }

    return root;
}

Array.fromIndices2D = function arrayFromIndices2D(i, j, cb) {
    let result = Array.empty2D(i, j);

    for (let y = 0; y < i; ++y) {
        for (let x = 0; x < j; ++x) {
            result[y][x] = cb(y, x);
        }
    }

    return result;
}

/**
 * Create a two dimensional array filled with the given value
 * @param {number} i First dimension
 * @param {number} j Second dimension
 * @param {*} val Value to fill with. Must be a value that behaves well when copied shallow.
 */
Array.filled2D = function arrayFilled2D(i, j, val) {
    let root = new Array(i);
    let copy = new Array(j);

    for (let x = 0; x < copy.length; ++x) {
        copy[x] = val;
    }

    for (let x = 0; x < root.length; ++x) {
        root[x] = copy.slice(0);
    }

    return root;
}

Array.prototype.argmax = function arrayArgMax() {
    let bestIndex;
    let bestValue = -Infinity;
    for (let i = 0; i < this.length; ++i) {
        if (this[i] > bestValue) {
            bestIndex = i;
            bestValue = this[i];
        }
    }
    return bestIndex;
}

Array.prototype.dilateBoolean2D = function arrayDilateBoolean2D(k) {
    if (!Number.isSafeInteger(k) || k <= 0) throw Error("Invalid k: " + k);

    // Dilate optimized for boolean arrays, where true > false by definition.
    // Any entry with a truethy value in the input array within a Chebyshev distance of k
    // will be true, otherwise false.

    const height = this.length;
    const width = this[0].length;

    const result = Array.filled2D(height, width, false);

    for (let y = 0; y < height; ++y) {
        nextEntry:
        for (let x = 0; x < width; ++x) {
            for (let dy = -k; dy <= k; ++dy) {
                for (let dx = -k; dx <= k; ++dx) {
                    const nx = x + dx, ny = y + dy;
                    if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;

                    if (this[ny][nx]) {
                        result[y][x] = true;
                        continue nextEntry;
                    }
                }
            }
        }
    }

    return result;
}

Array.prototype.erodeBoolean2D = function arrayErodeBoolean2D(k) {
    if (!Number.isSafeInteger(k) || k <= 0) throw Error("Invalid k: " + k);

    // Erode optimized for boolean arrays, where true > false by definition.
    // Any entry with a falsy value in the input array within a Chebyshev distance of k
    // will be false, otherwise true.

    const height = this.length;
    const width = this[0].length;

    const result = Array.filled2D(height, width, true);

    for (let y = 0; y < height; ++y) {
        nextEntry:
        for (let x = 0; x < width; ++x) {
            for (let dy = -k; dy <= k; ++dy) {
                for (let dx = -k; dx <= k; ++dx) {
                    const nx = x + dx, ny = y + dy;
                    if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;

                    if (!this[ny][nx]) {
                        result[y][x] = false;
                        continue nextEntry;
                    }
                }
            }
        }
    }

    return result;
}

Array.prototype.erode2D = function arrayErode2D(k) {
    const height = this.length;
    const width = this[0].length;

    const result = Array.empty2D(height, width);

    for (let y = 0; y < height; ++y) {
        for (let x = 0; x < width; ++x) {
            let max = this[y][x];

            for (let dx = -k; dx <= k; ++dx) {
                for (let dy = -k; dy <= k; ++dy) {
                    const nx = x + dx, ny = y + dy;
                    if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;

                    if (this[ny][nx] > max) max = this[ny][nx];
                }
            }

            result[y][x] = (max === this[y][x]) ? max : 0;
        }
    }

    return result;
}

/**
 * Same as map, but transform using (index, element) tuple
 */
Array.prototype.mapEnumerate = function arrayMapEnumerate(transform) {
    let result = new Array(this.length);

    for (let i = 0; i < this.length; ++i) {
        result[i] = transform(i, this[i]);
    }

    return result;
}

Array.prototype.maxPool2D = function arrayMaxPool2D(k) {
    const height = this.length;
    const width = this[0].length;

    const result = Array.empty2D(height, width);

    for (let y = 0; y < height; ++y) {
        for (let x = 0; x < width; ++x) {
            let max = this[y][x];

            for (let dx = -k; dx <= k; ++dx) {
                for (let dy = -k; dy <= k; ++dy) {
                    const nx = x + dx, ny = y + dy;
                    if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;

                    if (this[ny][nx] > max) max = this[ny][nx];
                }
            }

            result[y][x] = max;
        }
    }

    return result;
}

Array.prototype.fnMax = function arrayFnMax(scoringFunction) {
    let best = null;
    let bestScore = 0;

    for (let i = 0; i < this.length; ++i) {
        let score = scoringFunction(this[i]);
        if (best == null || score > bestScore) {
            best = this[i];
            bestScore = score;
        }
    }

    return best;
}

Array.prototype.fnMin = function arrayFnMin(scoringFunction) {
    let best = null;
    let bestScore = 0;

    for (let i = 0; i < this.length; ++i) {
        let score = scoringFunction(this[i]);
        if (best == null || score < bestScore) {
            best = this[i];
            bestScore = score;
        }
    }

    return best;
}

Array.prototype.fnValMin = function arrayFnValMin(scoringFunction) {
    let bestScore = null;

    for (let i = 0; i < this.length; ++i) {
        let score = scoringFunction(this[i]);
        if (bestScore == null || score < bestScore) {
            bestScore = score;
        }
    }

    return bestScore;
}

Array.prototype.zip = function arrayZip(other, zipper) {
    if (this.length !== other.length) {
        throw Error("Cannot zip on length mismatch");
    }

    let result = new Array(this.length);

    for (let i = 0; i < this.length; ++i) {
        result[i] = zipper(this[i], other[i]);
    }

    return result;
}

Number.positiveMod = function numberPositiveMod(k, n) {
    return ((k%n)+n)%n;
}