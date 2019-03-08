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

export class PriorityQueue {
    /**
     * Construct new priority queue with specified comparator function
     * @param {function} comparator Function taking two arguments returning negative number
     * if first argument smaller, 0 if equal, otheriwse positive.
     */
    constructor(comparator) {
        this._comparator = comparator;
        this._content = [];
    }

    clear() {
        this._content = [];
    }

    count() {
        return this._content.length;
    }

    /**
     * Dequeue the smallest item as determined by the comparator function.
     */
    dequeue() {
        const c = this._content;
        const comp = this._comparator;

        if (c.length === 0) {
            throw Error("Cannot dequeue from empty queue");
        }

        const front = c[0];

        let lastIndex = c.length - 1;
        c[0] = c[lastIndex];
        c.pop();

        --lastIndex;
        let parentIndex = 0;

        for (;;) {
            // Set child index to left child first
            let childIndex = parentIndex * 2 + 1;

            // If left child out of bounds, right child too, stop
            if (childIndex > lastIndex) {
                break;
            }

            // If right child exists and right child smaller left child, continue with right child
            // to always continue with smaller child
            const rightChildIndex = childIndex + 1;
            if (rightChildIndex <= lastIndex && comp(c[rightChildIndex], c[childIndex]) < 0) {
                childIndex = rightChildIndex;
            }

            // If parent already smaller or equal to smallest child, nothing to do, heap is heapified
            if (comp(c[parentIndex], c[childIndex]) <= 0) {
                break;
            }

            // Else had a smaller child, swap child and parent and continue downwards
            const tmp = c[parentIndex];
            c[parentIndex] = c[childIndex];
            c[childIndex] = tmp;

            // Take swapped child as new parent, other child remains heapified
            parentIndex = childIndex;
        }

        return front;
    }

    /**
     * Enqueue a new item
     * @param {*} item Item to enqueue
     */
    enqueue(item) {
        const c = this._content;
        const comp = this._comparator;

        // Add item as new leave to end of heap
        c.push(item);

        // Set child index to just inserted item
        let childIndex = c.length - 1;

        // While we haven't reached the root
        while (childIndex > 0) {
            // Calculate parent index of current child
            let parentIndex = Math.floor((childIndex - 1) / 2);

            // If the child is larger or equal to the parent, already heapified,
            // nothing more to do
            if (comp(c[childIndex], c[parentIndex]) >= 0) {
                break;
            }

            // Else swap parent and child
            const tmp = c[childIndex];
            c[childIndex] = c[parentIndex];
            c[parentIndex] = tmp;

            // Select parent node as new child
            childIndex = parentIndex;
        }
    }
}