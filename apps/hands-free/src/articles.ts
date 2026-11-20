// The three articles as data (requirement 10): original, plain text on everyday topics. No DOM and no Tokk import.
// They are rendered with textContent, never as HTML.

export interface Article { id: string; title: string; summary: string; paragraphs: readonly string[] }

export const ARTICLES: readonly Article[] = [
  {
    id: 'bread-rises',
    title: 'Why bread rises',
    summary: 'Tiny living yeast cells puff up a lump of dough with gas.',
    paragraphs: [
      'Bread dough starts as a heavy, sticky lump of flour and water. A few hours later it can be twice as big, soft and full of bubbles. Nothing was added to it in between. The change comes from inside.',
      'The secret is yeast, a living thing so small that you cannot see one cell. A spoonful of dry yeast holds millions of them, asleep. When they meet water and a little warmth, they wake up and get hungry.',
      'Flour contains starch, and starch contains sugar that the yeast can eat. As the cells feed, they give off a gas called carbon dioxide. This is the same gas that makes the bubbles in fizzy drinks.',
      'The gas has nowhere to go. Kneading has turned the flour and water into a stretchy net of thin strands. Each strand traps a little gas, like a tiny balloon. Millions of small balloons make the whole lump swell.',
      'Warmth matters a great deal. In a cold kitchen the yeast works slowly, so the dough may need most of a day. In a warm room it can double in an hour. Too much heat, though, will harm the cells.',
      'Salt and sugar change the pace as well. A little sugar gives the yeast an easy meal, while a little salt slows it down and adds flavor. Bakers learn to balance these things by feel and by habit.',
      'When the dough is ready, it goes into a hot oven. For a short time the yeast works faster than ever, and the loaf grows a last time. Then the heat becomes too strong and the cells stop for good.',
      'The oven also turns the soft net of strands into a firm crumb. The gas bubbles stay behind as small holes. That is why a slice of bread looks like a sponge, and why fresh bread feels light in the hand.',
    ],
  },
  {
    id: 'vanishing-puddles',
    title: 'Where puddles go',
    summary: 'A puddle disappears because its water slowly turns into an invisible gas.',
    paragraphs: [
      'After a heavy rain the street is full of puddles. By the afternoon, many of them are smaller. By the next day, some have disappeared completely. The water did not soak away in every case. Much of it went up into the air.',
      'The name for this is evaporation. Water is made of tiny pieces that are always moving. Those at the surface can break free and drift off into the air as an invisible gas called water vapor.',
      'Heat speeds the process up. Warm water pieces move faster, so more of them escape each second. This is why a puddle in bright summer sun is gone in an hour, while one in a cold shadow can stay for days.',
      'Wind helps too. Moist air sits just above a puddle and slows the escape of more vapor. A breeze carries that damp air away and brings in drier air, so the puddle keeps giving up its water.',
      'Some of the water does sink down. Bare soil and gravel drink it in, which is why a puddle on a dirt path fades faster than one on a flat paved road. Hard, smooth ground gives the water nowhere to hide.',
      'The shape of a puddle matters. A wide, shallow puddle has a large surface for its small amount of water, so it dries fast. A deep, narrow one has less surface and takes much longer to vanish.',
      'The water is never truly lost. Vapor rises, cools high above the ground, and gathers into drops so small that they float. Those drops form clouds. Later they grow heavy and fall again as rain.',
      'So the next time you see a puddle shrinking, remember that you are watching part of a great loop. The same water rises, travels, falls and rises once more. It has been doing this for a very long time.',
    ],
  },
  {
    id: 'houseplant-basics',
    title: 'Keeping a houseplant alive',
    summary: 'Most houseplants need only the right light, the right amount of water and a little patience.',
    paragraphs: [
      'A houseplant is a living thing that sits in a small pot and cannot move to find what it needs. It depends on you for light, water and room to grow. Meeting those needs is easier than it sounds.',
      'Start with light. Leaves use sunshine to make food, so a plant in a dark corner slowly starves. Most indoor plants like a bright spot near a window, but not a place where hot, direct sun burns the leaves.',
      'Watch the leaves for clues. If the plant leans hard toward the window, it wants more light. If the leaves turn pale or grow long, thin stems with wide gaps, the plant is reaching for light and the spot is too dim.',
      'Water is where most people go wrong. Too much is a bigger danger than too little. Roots need air as well as water, and soil that stays soaked will rot them. Always test the soil before you pour.',
      'A simple test works well. Push a finger about the depth of a knuckle into the soil. If it feels dry, give the plant a slow, generous drink. If it still feels damp, wait a few more days.',
      'The pot needs a hole in the bottom so that extra water can drain out. A plant that stands in a puddle at the base of its pot will suffer. Empty the saucer after the water has run through.',
      'Plants grow slowly, so be patient. A new leaf may take weeks to open. In the darker months most plants rest and need less water. In spring, when growth picks up, they like a bit more food and care.',
      'Over time the roots fill the pot and have no room left. When you see roots poking out of the bottom, move the plant to a pot only slightly larger. A gentle move, fresh soil and some water will help it settle.',
    ],
  },
];
