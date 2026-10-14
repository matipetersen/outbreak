"""The people who travel with you: archetypes with a strength, a flaw and a voice.

Every non-hostile person can become your companion (a trader, a healer, a patrol member, a stranger you saved), and
whoever they are they get a personal name and one of these profiles, fixed by their id.  One companion at a time; when
they die, they stay dead.
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Dict, Tuple


@dataclass(frozen=True)
class Archetype:
    id: str
    label: str                    # "veteran"
    strength: str
    flaw: str
    hp: int
    dmg: Tuple[int, int]
    acc: int
    intro: str                    # what they say when they fall in beside you
    idle: Tuple[str, ...]
    kill: Tuple[str, ...]
    hurt: Tuple[str, ...]
    farewell: str                 # said when they leave, or what you remember them saying
    backstory: Tuple[str, str, str]


STRENGTHS: Dict[str, str] = {
    "fighter": "hits hard and shoots straight",
    "medic": "patches you up when you are hurt",
    "scavenger": "finds something useful whenever you come back out of a building",
    "scout": "spots ambushes and snares before you walk into them",
    "calm": "steadies your nerves",
    "tinker": "keeps your weapon in repair",
    "tough": "can take a beating",
    "lucky": "has a way of coming back with something",
}

FLAWS: Dict[str, str] = {
    "coward": "runs when it gets bad",
    "loud": "cannot keep quiet, and noise draws the dead",
    "hungry": "eats from your pack",
    "frail": "will not survive much",
    "pacifist": "will not fight people, and judges you if you do",
    "reckless": "charges in and will not break off",
}

ARCHETYPES: Tuple[Archetype, ...] = (
    Archetype("veteran", "veteran", "fighter", "reckless", 40, (5, 9), 68,
              "\"You look like you know where you are going. I know how to hit things. Seems fair.\"",
              ("\"Keep your head down and your feet moving. That is all I ever learned.\"",
               "\"I have walked into worse. I just do not remember when.\"",
               "\"Quiet is good. Quiet means nothing is hunting us yet.\""),
              ("\"One less.\"", "\"Stay down.\""),
              ("\"Scratch. Keep going.\"",),
              "\"Do not wait for me. Never wait for me.\"",
              ("\"I was somebody's sergeant once. They are all dead now. I count them when I cannot sleep.\"",
               "\"I charge because stopping is when I remember. You can hate that about me.\"",
               "\"I am not afraid of dying out here. I am afraid of being the only one left again.\"")),
    Archetype("medic", "medic", "medic", "frail", 16, (2, 4), 45,
              "\"I can keep you alive if you can keep me alive. That is the whole arrangement.\"",
              ("\"Drink something. Please. I am tired of watching people forget.\"",
               "\"Every one of these buildings had a clinic once.\"",
               "\"Tell me if anything hurts. Anything.\""),
              ("\"I... did that?\"",),
              ("\"I am fine. I am fine. I am not fine.\"",),
              "\"You did everything right. Remember that.\"",
              ("\"I was three weeks from finishing my residency. I still sign things with the wrong title.\"",
               "\"I counted the ones I could not save. I stopped counting at forty.\"",
               "\"If it comes to a choice, save the one who can walk. I have already decided that about myself.\"")),
    Archetype("scavenger", "scavenger", "scavenger", "loud", 24, (3, 6), 52,
              "\"Mina. I find things. Do not ask me to be quiet, I get nervous.\"",
              ("\"Heh. Heh. Did you see that shelf? We should have taken the shelf.\"",
               "\"Nothing is ever really empty. People just do not look under things.\"",
               "\"I talk when I am scared. Did I mention I talk when I am scared?\""),
              ("\"Whoa! Okay. Okay!\"", "\"Did I do that? I did that.\""),
              ("\"Ow ow ow ow.\"",),
              "\"Take the red bag. It has the good stuff. Go.\"",
              ("\"I ran a stall at the night market. Fourteen years. Everything has a price, and I know all of them.\"",
               "\"The first thing I stole out here was a stranger's shoes. They did not need them anymore.\"",
               "\"You are the first person who did not ask me to shut up. I will remember that.\"")),
    Archetype("hunter", "hunter", "scout", "hungry", 28, (3, 7), 55,
              "\"I walk quiet and I eat a lot. Both are true. You will see.\"",
              ("\"Wind has changed. Smell that? Rain by evening.\"",
               "\"I would trade my whole kit for one hot meal.\"",
               "\"Tracks over there. Old. Do not worry about them.\""),
              ("\"Clean.\"", "\"Dinner.\""),
              ("\"That is nothing. I have been bitten by worse.\"",),
              "\"Keep to the trees. They hide a person better than a wall.\"",
              ("\"I grew up on a farm that ate us all in a hard year. I never trusted full pantries after.\"",
               "\"There was a dog. I will not talk about the dog.\"",
               "\"I leave food out for the strays. I know it makes noise. I do it anyway.\"")),
    Archetype("mechanic", "mechanic", "tinker", "coward", 26, (3, 6), 50,
              "\"If it has moving parts, I can make it keep moving. Please do not make me go first.\"",
              ("\"Your weapon is balanced wrong. I will fix it when we stop. If we stop.\"",
               "\"There is always a way to make it work. There is rarely a good way.\"",
               "\"Do you hear that? Probably nothing. Probably.\""),
              ("\"I did NOT want to do that.\"",),
              ("\"Can we go? Can we please go?\"",),
              "\"I left the toolbox. It was heavy. Sorry. Sorry.\"",
              ("\"I fixed elevators for twenty years. I got stuck in one for two days when it started.\"",
               "\"Fear is just information. Mine says run, mostly.\"",
               "\"The only time I was not scared was fixing something. Thank you for letting me.\"")),
    Archetype("preacher", "preacher", "calm", "pacifist", 24, (2, 4), 40,
              "\"I will walk with you. I will not hurt anyone. If that is a problem, say so now.\"",
              ("\"We are not the first to walk this road, and we will not be the last.\"",
               "\"Breathe. Count to four. Again.\"",
               "\"Everyone out here is somebody's something.\""),
              ("\"Forgive me.\"",),
              ("\"It is only the body.\"",),
              "\"Let it go. You are lighter without it. Go on.\"",
              ("\"I took vows I do not believe anymore. I keep the habit because people need to see it.\"",
               "\"I prayed over a hundred of them. None of them were mine.\"",
               "\"I will hurt someone to save you, one day. I would rather you do not ask me to say that out loud.\"")),
    Archetype("brute", "brute", "tough", "loud", 52, (4, 8), 58,
              "\"Dag. I carry things and I hit things. Where to?\"",
              ("\"HA. Did you see that one go?\"", "\"Is there food? I am always asking about food.\"",
               "\"I am quiet! I am being quiet!\""),
              ("\"Another!\"", "\"Next!\""),
              ("\"Pfft. Feels like a bee.\"",),
              "\"Keep walking. I will hold the door. I always hold the door.\"",
              ("\"I was a bouncer. Then a roofer. I am good at standing in doorways.\"",
               "\"My brother was bigger than me. That is what everyone says about him now.\"",
               "\"People are afraid of me. I wish they were not. You are not. Thank you.\"")),
    Archetype("gambler", "gambler", "lucky", "coward", 26, (3, 6), 54,
              "\"Name is not important. Luck is. Stay close and some of it might rub off.\"",
              ("\"Odds are odds. Never fight a bad one.\"", "\"I once drew three aces in a row. Then the world ended. Coincidence?\"",
               "\"Nothing is certain. That is what makes it fun. And terrifying.\""),
              ("\"Beginner's luck.\"",),
              ("\"The house always wins, huh.\"",),
              "\"I bet you make it. I have never been right about anything, but I bet you make it.\"",
              ("\"I owe money to people who are probably dead. It does not feel like freedom.\"",
               "\"I bluff. I always bluff. Right now I am bluffing that I am not afraid.\"",
               "\"You are the only bet I have ever hoped to lose to.\"")),
)

BY_ID: Dict[str, Archetype] = {a.id: a for a in ARCHETYPES}

# The same people in another age: what a trade is called, and the lines that only make sense with machines, clinics and bouncers.
# (archetype id, era id) -> the fields that change.
ERA_VARIANTS: Dict[Tuple[str, str], dict] = {
    ("mechanic", "medieval"): dict(
        label="smith",
        intro="\"If it has a hinge or an edge, I can mend it. Please do not make me go first.\"",
        idle=("\"Your blade is balanced wrong. I will fix it when we stop. If we stop.\"",
              "\"There is always a way to make it hold. There is rarely a good way.\"",
              "\"Do you hear that? Probably nothing. Probably.\""),
        farewell="\"I left the tools. They were heavy. Sorry. Sorry.\"",
        backstory=("\"I was a wheelwright's apprentice for twenty years. I got shut in a granary for two days when the bells started.\"",
                   "\"Fear is just information. Mine says run, mostly.\"",
                   "\"The only time I was not scared was mending something. Thank you for letting me.\"")),
    ("mechanic", "scifi"): dict(
        label="engineer",
        intro="\"If it has a circuit, I can make it keep running. Please do not make me go first.\"",
        backstory=("\"I serviced airlocks for twenty years. I got stuck in one for two days when the lockdown started.\"",
                   "\"Fear is just information. Mine says run, mostly.\"",
                   "\"The only time I was not scared was fixing something. Thank you for letting me.\"")),
    ("medic", "medieval"): dict(
        label="herbalist",
        idle=("\"Drink something. Please. I am tired of watching people forget.\"",
              "\"Every one of these houses had a sickroom once.\"",
              "\"Tell me if anything hurts. Anything.\""),
        backstory=("\"I was three weeks from taking my vows as an infirmarian. I still sign things with the wrong name.\"",
                   "\"I counted the ones I could not save. I stopped counting at forty.\"",
                   "\"If it comes to a choice, save the one who can walk. I have already decided that about myself.\"")),
    ("medic", "scifi"): dict(
        idle=("\"Drink something. Please. I am tired of watching people forget.\"",
              "\"Every one of these decks had a medbay once.\"", "\"Tell me if anything hurts. Anything.\""),
        backstory=("\"I was three weeks from finishing my rotation. I still sign things with the wrong title.\"",
                   "\"I counted the ones I could not save. I stopped counting at forty.\"",
                   "\"If it comes to a choice, save the one who can walk. I have already decided that about myself.\"")),
    ("scavenger", "medieval"): dict(
        label="pedlar",
        backstory=("\"I ran a stall at the fair. Fourteen years. Everything has a price, and I know all of them.\"",
                   "\"The first thing I took out here was a stranger's boots. They did not need them anymore.\"",
                   "\"You are the first person who did not ask me to shut up. I will remember that.\"")),
    ("scavenger", "scifi"): dict(
        backstory=("\"I ran a stall in the dock market. Fourteen years. Everything has a price, and I know all of them.\"",
                   "\"The first thing I took out here was a stranger's boots. They did not need them anymore.\"",
                   "\"You are the first person who did not ask me to shut up. I will remember that.\"")),
    ("brute", "medieval"): dict(
        backstory=("\"I was a gate-warden. Then a thatcher. I am good at standing in doorways.\"",
                   "\"My brother was bigger than me. That is what everyone says about him now.\"",
                   "\"People are afraid of me. I wish they were not. You are not. Thank you.\"")),
    ("brute", "scifi"): dict(
        backstory=("\"I was a dock loader. Then hull maintenance. I am good at standing in doorways.\"",
                   "\"My brother was bigger than me. That is what everyone says about him now.\"",
                   "\"People are afraid of me. I wish they were not. You are not. Thank you.\"")),
    ("veteran", "medieval"): dict(label="man-at-arms"),
    ("preacher", "medieval"): dict(label="friar"),
    ("gambler", "medieval"): dict(
        label="dicer",
        idle=("\"Odds are odds. Never fight a bad one.\"", "\"I once threw three sixes in a row. Then the world ended. Coincidence?\"",
              "\"Nothing is certain. That is what makes it fun. And terrifying.\"")),
}

# Who a person is when you only know their trade or what they do for a living
ROLE_ARCHETYPE: Dict[str, str] = {"healer": "medic", "trader": "scavenger", "scholar": "mechanic", "scout": "hunter",
                                  "soldier": "veteran", "raider": "brute"}

NAMES: Tuple[str, ...] = ("Ruiz", "Okafor", "Mina", "Tomas", "Joon", "Lena", "Dag", "Vesper", "Kaito", "Ada", "Marek", "Sol",
                          "Imani", "Bruno", "Nadia", "Pip", "Ines", "Haruto", "Cass", "Oren", "Talia", "Wren", "Yusuf", "Greta",
                          "Beck", "Sasha", "Ravi", "Noor", "Dmitri", "Lucia", "Fenn", "Odile")

# What they shout when it turns violent
COMBAT_LINES: Dict[str, Tuple[str, ...]] = {
    "engage": ("\"Contact!\"", "\"On me!\"", "\"I see it. I have got it.\"", "\"Here they come!\""),
    "regroup": ("\"Wait! Do not leave me here!\"", "\"Where are you going? Wait for me!\"", "\"I am coming! Keep moving!\""),
    "player_hurt": ("\"You are hit! Get back!\"", "\"Behind you!\"", "\"Stay with me, I have got you!\""),
    "flee": ("\"I cannot do this! Fall back!\"", "\"Back! Everybody back!\"", "\"Run!\""),
}

# What they say about the world, whoever they are
SITUATION_LINES: Dict[str, Tuple[str, ...]] = {
    "night": ("\"I do not like the dark. Nobody should.\"", "\"Let us find somewhere with walls.\""),
    "rain": ("\"At least the rain covers the sound.\"", "\"Rain again. My boots have given up.\""),
    "fog": ("\"I can barely see you. Stay close.\"",),
    "storm": ("\"Thunder. Everything hears thunder. Be careful.\"",),
    "forest": ("\"Too many trees. I do not trust a place that quiet.\"", "\"Listen. Even the birds went silent.\""),
    "cave": ("\"I will wait here. I am not going down there. Take the light.\"",),
    "hungry": ("\"Are we eating soon? I can hear my stomach arguing.\"",),
    "hurt": ("\"You are bleeding. Do something about it.\"", "\"You do not look good. Rest.\""),
    "refuge": ("\"Walls. Real walls. I forgot what that feels like.\"",),
    "warning": ("\"Contact!\"", "\"Something is moving.\""),
}


# At a bond of 60 each companion asks for one thing: go to a place that was theirs and bring back what is left of it.
# kind: the sort of building it is; ask / found / scene: what is said; give / keep / read: the three ways it can end;
# boon: what changes in them if you give it back.
PERSONAL: Dict[str, Dict[str, str]] = {
    "veteran": {"kind": "military", "place": "an old post",
                "ask": "\"There is a post, not far. My unit's. I have not been back. There is a tin with my squad's tags in it. I need it, and I cannot make myself go.\"",
                "found": "A tin of tags, and a letter nobody ever sent.",
                "scene": "They hold the tin for a long time and do not open it. \"All of them. Every one.\" Their hands are very steady.",
                "give": "You give it back without a word. \"I will not charge in blind again. Not with you beside me.\"",
                "keep": "You tell them it was gone. They look at you, and they know, and say nothing.",
                "read": "You read the names with them, one by one. By the end, neither of you is the same.",
                "boon": "reckless: they hold the line and stay near you now."},
    "medic": {"kind": "medical", "place": "a clinic",
              "ask": "\"My old clinic. There is a case in the back with my notes and my mother's ring. Please. I need to know whether I am still a doctor.\"",
              "found": "A battered case: notes in a careful hand, and a thin gold ring.",
              "scene": "They put the ring on, and cry, and laugh at themselves for crying. \"I am still a doctor. I am still one.\"",
              "give": "You give it back. \"I am not so afraid to be hurt now. Let me do my job.\"",
              "keep": "You say the clinic was burned. They do not argue. Something in them goes out.",
              "read": "You read the notes together. They have been writing letters to the dead.",
              "boon": "frail: tougher than they were (+12 health)."},
    "scavenger": {"kind": "market", "place": "a stall",
                  "ask": "\"My stall. Fourteen years. There is a tin box under the counter, with the first coin I ever made. Will you go for it?\"",
                  "found": "A tin box with one old coin and a receipt for a life.",
                  "scene": "They turn the coin over and over. \"It was a good stall.\" They are very quiet. That is rare.",
                  "give": "You give it back. \"I will keep my mouth shut when it matters. I swear. Mostly.\"",
                  "keep": "You tell them the stall was empty. You pocket the coin. They never mention it again.",
                  "read": "You count the receipt line by line. It is the funniest and saddest thing you have read.",
                  "boon": "loud: they have learned to be quiet."},
    "hunter": {"kind": "house", "place": "a farmhouse",
               "ask": "\"There is a house, past the fields. My family's. There is a jar in the pantry I would like to hold again.\"",
               "found": "A jar of preserves, sealed with a child's drawing.",
               "scene": "They open it, and the smell fills the room, and they eat one spoonful, slowly, with their eyes shut.",
               "give": "You give it back. \"I will not eat your food behind your back. I will ask. I promise.\"",
               "keep": "You say the pantry was bare. They nod slowly and stop talking about home.",
               "read": "You share the jar between you. It is the best thing you have eaten in a hundred days.",
               "boon": "hungry: they stop helping themselves to your pack."},
    "mechanic": {"kind": "industry", "place": "a workshop",
                 "ask": "\"My shop. My good wrench is still there. It is a stupid thing to ask. But I need it. It is the only thing I was ever good at.\"",
                 "found": "A heavy wrench with a name scratched into the handle.",
                 "scene": "They hold the wrench like a sword. \"I can fix this. I can fix a lot of things.\"",
                 "give": "You give it back. \"I will stand my ground. I will. I have something to hold on to.\"",
                 "keep": "You say the shop was cleared out. They stop looking at tools.",
                 "read": "You turn the wrench over and read the scratched name. They tell you who it was.",
                 "boon": "coward: they stand their ground (flee only when badly hurt)."},
    "preacher": {"kind": "faith", "place": "a chapel",
                 "ask": "\"My chapel. There is a book of names there, the people I buried. I would like to hold it once more.\"",
                 "found": "A book of names in a dozen hands.",
                 "scene": "They add a name to the last page: yours. \"In case,\" they say. \"Only in case.\"",
                 "give": "You give it back. \"I will not let you die for my principles. I will defend you.\"",
                 "keep": "You say the chapel was ash. They do not pray that night.",
                 "read": "You read the names aloud, all of them, one by one. It takes a long time. Neither of you minds.",
                 "boon": "pacifist: they will fight to defend you."},
    "brute": {"kind": "guard", "place": "a station",
              "ask": "\"The station where I worked. There is a locker with a photo of my brother. Big man, bigger than me. I want it back.\"",
              "found": "A photo, creased white, of two big men laughing.",
              "scene": "They hold it with two fingers, as though it might break. \"He was bigger than me. Everybody says so.\"",
              "give": "You give it back. \"I will keep my voice down. I will. For him.\"",
              "keep": "You say the locker was empty. They do not ask twice.",
              "read": "You study the photo together. You can see the family in both faces.",
              "boon": "loud: they have learned to keep their voice down."},
    "gambler": {"kind": "market", "place": "a card room",
                "ask": "\"There is a card room. My lucky deck is in the safe. I do not want to be lucky. I want to see it again.\"",
                "found": "A worn deck of cards, and an ace of spades with a name on the back.",
                "scene": "They shuffle once, with one hand. \"The odds were never good. I played them anyway.\"",
                "give": "You give it back. \"I will stop folding. When it counts, I am all in.\"",
                "keep": "You say the safe was empty. They shuffle an imaginary deck for days.",
                "read": "You read the name on the ace. It is a debt. They tell you how they paid it.",
                "boon": "coward: they stand their ground (flee only when badly hurt)."},
}


# The same errands in another age (only the lines that name a thing that did not exist yet)
PERSONAL_VARIANTS: Dict[Tuple[str, str], Dict[str, str]] = {
    ("veteran", "medieval"): {
        "found": "A tin of tokens, one for each of the company, and a letter nobody ever sent.",
        "ask": "\"There is a guardhouse, not far. My company's. I have not been back. There is a tin with my men's tokens in it. I need it, and I cannot make myself go.\"",
        "place": "an old guardhouse",
        "scene": "They hold the tin for a long time and do not open it. \"All of them. Every one.\" Their hands are very steady.",
        "read": "You read the names scratched on the tokens with them, one by one. By the end, neither of you is the same."},
    ("medic", "medieval"): {
        "place": "an infirmary",
        "ask": "\"My old infirmary. There is a chest in the back with my notes and my mother's ring. Please. I need to know whether I am still a healer.\"",
        "found": "A battered chest: notes in a careful hand, and a thin gold ring.",
        "scene": "They put the ring on, and cry, and laugh at themselves for crying. \"I am still a healer. I am still one.\"",
        "keep": "You say the infirmary was burned. They do not argue. Something in them goes out."},
    ("scavenger", "medieval"): {
        "found": "A tin box with one old coin and a tally stick for a life.",
        "read": "You count the notches on the tally stick one by one. It is the funniest and saddest thing you have read."},
    ("mechanic", "medieval"): {
        "place": "a smithy",
        "ask": "\"My forge. My good hammer is still there. It is a stupid thing to ask. But I need it. It is the only thing I was ever good at.\"",
        "found": "A heavy hammer with a name scratched into the handle.",
        "scene": "They hold the hammer like a sword. \"I can mend this. I can mend a lot of things.\"",
        "keep": "You say the forge was cleared out. They stop looking at tools.",
        "read": "You turn the hammer over and read the scratched name. They tell you who it was."},
    ("mechanic", "scifi"): {
        "place": "a repair bay",
        "ask": "\"My bay. My good wrench is still there. It is a stupid thing to ask. But I need it. It is the only thing I was ever good at.\""},
    ("brute", "medieval"): {
        "place": "a gatehouse",
        "ask": "\"The gatehouse where I stood watch. There is a chest with a carved token of my brother. Big man, bigger than me. I want it back.\"",
        "found": "A carved wooden token, worn smooth, of two big men laughing.",
        "scene": "They hold it with two fingers, as though it might break. \"He was bigger than me. Everybody says so.\"",
        "keep": "You say the chest was empty. They do not ask twice.",
        "read": "You study the carving together. You can see the family in both faces."},
    ("gambler", "medieval"): {
        "place": "a dice den",
        "ask": "\"There is a dice den. My lucky bones are in the chest. I do not want to be lucky. I want to hold them again.\"",
        "found": "A pair of worn bone dice, and a name cut into one of them.",
        "scene": "They shake them once, in one hand. \"The odds were never good. I played them anyway.\"",
        "give": "You give it back. \"I will stop folding. When it counts, I stake it all.\"",
        "keep": "You say the chest was empty. They rattle empty fists for days.",
        "read": "You read the name cut into the die. It is a debt. They tell you how they paid it."},
}


# What they say when you hand them something to fight or dress with
GEAR_SAY: Dict[str, Tuple[str, ...]] = {
    "weapon": ("\"Better than nothing. Thank you.\"", "\"I will take care of it. I will.\"", "\"Now we are talking.\"",
               "\"I know how to use this. Mostly.\""),
    "armor": ("\"That will turn a blow or two. Thank you.\"", "\"Heavier than it looks. I like it.\"",
              "\"I feel safer already.\""),
    "ammo": ("\"I will count every one.\"", "\"I will not waste these.\""),
    "coward_armor": ("\"Armour. Oh, good. Oh, thank you. I will stand closer to it.\"",),
    "reckless_weapon": ("\"Oh, now I am dangerous.\"",),
}

