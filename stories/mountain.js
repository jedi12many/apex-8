// The Mountain: the story mode's demo (core/story.js). A traveller reaches the foot of APEX and meets
// its guide. It pans over the APEX-8 badge's art, zooms up to the summit and pulls back (one run of
// frames, played forwards then backwards), turns the world at the end, and shows pages, choices, a
// choice that only appears until it is taken (a flag), and the start again at the end.
(function (root, story) {
  if (typeof module === 'object' && module.exports) module.exports = story;
  else (root.APEXSTORIES = root.APEXSTORIES || {}).mountain = story;
})(typeof self !== 'undefined' ? self : this, {
  name: 'The Mountain',
  song: 'peak',
  sounds: { type: 'type', more: 'more', move: 'move', choose: 'choose' },
  typeSpeed: 2,
  pictures: {
    // the badge's art, 48 x 38 cells (384 x 304 pixels): the sun, the mountain and the name
    peak: { file: 'art/brand/apex8-source.png', crop: [0, 100, 1254, 993], cells: [48, 38], saturation: 1.2, dither: 24 },
    // up to the summit: from the whole badge to the snow at the top
    closer: { file: 'art/brand/apex8-source.png', saturation: 1.2, dither: 24,
      frames: { count: 8, from: { x: 627, y: 560, w: 1300 }, to: { x: 627, y: 330, w: 240 } } },
    // the world turning, an eighth of a turn a frame
    spin: { file: 'art/brand/apex8-source.png', saturation: 1.2, dither: 24,
      frames: { count: 8, from: { x: 627, y: 560, w: 1100, angle: 0 }, to: { x: 627, y: 560, w: 1100, angle: 315 } } },
  },
  start: 'sunset',
  scenes: {
    sunset: {
      picture: 'peak', pan: { from: [32, 0], to: [32, 96], ticks: 384 },
      speaker: 'The Mountain',
      text: 'At the top of the world the sun sets behind a mountain of snow. Travellers say that whoever climbs it can make anything at all, in eight bits.\nYou have walked for days to reach it.',
      next: 'look_up',
    },
    look_up: {
      steps: { frames: 'closer', every: 5, still: { picture: 'peak', at: [32, 0] } },
      speaker: 'The Mountain',
      text: 'You look up. The summit seems close enough to touch.',
      next: 'far_again',
    },
    far_again: {
      steps: { frames: 'closer', every: 5, reverse: true, still: { picture: 'peak', at: [32, 96] } },
      speaker: 'The Mountain',
      text: 'Then it is far away again, as it always is.',
      next: 'guide',
    },
    guide: {
      picture: 'peak', pan: { from: [32, 96], to: [64, 160], ticks: 512 },
      speaker: 'The Guide',
      text: 'You have come a long way, traveller. Few reach the foot of APEX. What brings you here?',
      choices: [
        { text: 'I want to make a game.', go: 'game' },
        { text: 'What is this place?', go: 'place', unless: 'asked' },
        { text: 'I am only looking around.', go: 'look' },
      ],
    },
    place: {
      picture: 'peak', pan: { from: [64, 160], to: [0, 160], ticks: 512 }, set: 'asked',
      speaker: 'The Guide',
      text: 'This is APEX-8. Its paths lead down into dungeons, up through green hills, along dark corridors and out among the stars. Each one is drawn exactly the same on every machine that walks it.',
      next: 'again',
    },
    again: {
      picture: 'peak', pan: { from: [0, 160], to: [0, 160], ticks: 0 },
      speaker: 'The Guide',
      text: 'So. What brings you here?',
      choices: [
        { text: 'I want to make a game.', go: 'game' },
        { text: 'What is this place?', go: 'place', unless: 'asked' },
        { text: 'I am only looking around.', go: 'look' },
      ],
    },
    game: {
      picture: 'peak', pan: { from: [64, 160], to: [64, 191], ticks: 248 },
      speaker: 'The Guide',
      text: 'Then take what the mountain gives: a corridor to walk in, hills to run across, a dungeon to explore and a sky to fight in.\nAnd now a way to tell a story: a picture that moves slowly, like an old film, words beneath it, and choices that change what happens next.',
      next: 'summit',
    },
    look: {
      picture: 'peak', pan: { from: [0, 160], to: [0, 191], ticks: 248 },
      speaker: 'The Guide',
      text: 'Look all you like. The picture moves slowly, like an old film, and the words come a letter at a time. Press fire and they come all at once.',
      next: 'summit',
    },
    summit: {
      steps: { frames: 'spin', every: 6, still: { picture: 'peak', at: [32, 0] } },
      speaker: 'The Mountain',
      text: 'The sun goes down. The snow turns gold, then blue. Somewhere above you, a path begins.\nThe end. Press fire to begin again.',
      end: true,
    },
  },
});
