# Battlecode 2019 Submission by Team Wololo

## About
Battlecode 2019 was an artificial intelligence competition at MIT in January 2019 featuring the development
of an AI to control a turn-based strategy game. The overall objective was conquest through exploration, expansion,
exploitation and extermination (4X). Additionally, all units on the game board were controlled by individual VMs, 
only permitting a minimum of communication through radio, thus putting the focus on swarm behavior.

This repository contains the submission of team Wololo, consisting of Paul Hindricks, Maximilian Schier and
Niclas Wüstenbecker (in alphabetical order). Battlecode was part of a course on Artificial Intelligence at the
University of Hannover, Germany, realized by the Institute for Information Processing (TNT). Throughout this course
our team created this AI program. We qualified among the top 16 teams for the finals at MIT, placing 9th as the best German team.

## Installation and running
This AI program is essentially a library that is run through the official Battlecode 2019 program. Since this library
introduces no additional dependencies, no additional steps have to be taken after cloning this repository.
It is officially recommended by the tournament organizers to install via `npm install -g b19`. To let this AI play against
itself, run `bc19run -b . -r .` from this folder.

## Strategy
Due to the severe time restrictions placed on all VMs executing the unit AI code, most teams implemented a classic
reflex based AI. It is not known to us that any finalists implemented any game tree search or machine learning
based approaches, the latter also being hindered by JavaScript being the language of choice.

Our strategy mainly revolves around early aggressive economic expansion, while still keeping enough resources
to fend off a very early rush. This strategy generally beats less agressive expansions and loses to more agressive
expansions, which in turn are bested by rushes. Overall Battlecode 2019 had a very clear triangle of power in the early game,
similar to rock-paper-scissors.

Due to the nature of the game rules, the end game was very static with nearly all finalists building a defensive
lattice of long ranged units. Main shortcoming of our strategy was switching too late to the most cost effective unit,
which is worse at defending, losing our first two drawn out games by overall unit health.
