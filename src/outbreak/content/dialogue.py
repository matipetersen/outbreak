"""People with a voice: the folk of the havens and the patrols on the road.

Each role has two personas.  A persona is picked from the person's id, so the same person always sounds the same.
Lines are era-neutral on purpose; names come from a pool per era.
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Dict, Tuple

GIVEN: Dict[str, Tuple[str, ...]] = {
    "medieval": ("Aldric", "Maud", "Godwin", "Isolde", "Piers", "Hawise", "Osric", "Edda", "Ranulf", "Agnes", "Wystan", "Mabel"),
    "eighties": ("Dale", "Rhonda", "Walt", "Tammy", "Curtis", "Lorraine", "Gus", "Pat", "Ronnie", "Joyce", "Marv", "Dee"),
    "modern": ("Marta", "Idris", "Noor", "Tomas", "Priya", "Callum", "Ines", "Jonas", "Amara", "Reza", "Linh", "Dmitri"),
    "scifi": ("Kesh", "Voss", "Ilun", "Tarn", "Sora", "Okafor", "Nyx", "Brann", "Taiga", "Zhen", "Maro", "Eilis"),
}

ROLE_WORD = {"trader": "trader", "healer": "healer", "scholar": "archivist", "scout": "scout", "soldier": "soldier", "survivor": "survivor"}


@dataclass(frozen=True)
class Persona:
    tag: str
    trait: str                       # how they come across
    first: str                       # the first time you meet
    again: Tuple[str, ...]           # later visits
    hurt: str                        # you are hurt
    sick: str                        # you are bitten
    night: str
    company: str                     # you have someone with you
    bio: Tuple[str, ...]             # what they say about themselves, one at a time


PERSONAS: Dict[str, Tuple[Persona, ...]] = {
    "trader": (
        Persona("shrewd", "counts your pockets before your face",
                "\"New face. New face means new coin. Look all you like; touching costs.\"",
                ("\"Back again. Good. Last time you paid on time.\"", "\"Prices are what the road makes them. Blame the road.\""),
                "\"You are bleeding on my floor. Buy a bandage, I will mop for free.\"",
                "\"That arm. I do not want to know. Buy what you need and take it somewhere else.\"",
                "\"Night trade. Quiet, discreet, ten percent more. Do not look at me like that.\"",
                "\"Two mouths, twice the shopping. I like you already.\"",
                ("\"I kept books before this. Now I keep what can be eaten, burned or shot. Same discipline.\"",
                 "\"Everyone thinks I am greedy. Nobody asks who fed them in the first month.\"",
                 "\"My ledger has forty names in it, people who owe me. Thirty-one are dead. I keep them in anyway.\"")),
        Persona("weary", "has stopped haggling out of habit",
                "\"Take what you need. Pay what you can. I am too tired to argue about the difference.\"",
                ("\"Still alive. That makes two of us.\"", "\"If it is not on the shelf I do not have it. If it is, it costs what it costs.\""),
                "\"Sit before you fall. The bandages are on the left.\"",
                "\"Oh. Oh, that is a bite. Sit. I am sorry. Take what helps.\"",
                "\"You come at strange hours. We all do now.\"",
                "\"Good, you are not alone. Alone is how they find you.\"",
                ("\"I had a shop. Real windows. A bell on the door. I still wake up listening for it.\"",
                 "\"I never wanted to sell people bullets. Somebody had to, and I could not stomach somebody else.\"",
                 "\"My daughter would have been about your age. Do not ask. Buy something.\"")),
    ),
    "healer": (
        Persona("gentle", "talks to every wound like a nervous animal",
                "\"Come in, come in. Let me look at you. Do not be brave, it only slows me down.\"",
                ("\"You again. Good. That means the last one held.\"", "\"Wash your hands. I will say it every visit, so you may as well start.\""),
                "\"Sit. Now. Whatever you were about to say can wait for the stitches.\"",
                "\"That bite. Show me. No, do not hide it; I have seen forty of them. Let me look.\"",
                "\"Late. Hands are steadier in the morning, but yours cannot wait, can they.\"",
                "\"Bring them over too. I do not ask who hurts first.\"",
                ("\"I was a nurse on nights. The dead were already a problem then; they just stayed in their beds.\"",
                 "\"I lose one a week. I do the sums every Sunday. It does not get easier, only more regular.\"",
                 "\"I do not believe in a cure. I believe in clean water, sleep and not giving up on the next person.\"")),
        Persona("brusque", "treats wounds like they are late",
                "\"Sit. Shirt off. Do not tell me where it hurts, I will find it.\"",
                ("\"Not bleeding? Then why are you in my way?\"", "\"I bill by the stitch. The stitch is cheap. The silence is free.\""),
                "\"Sit. You look like something the cat dragged in and then thought better of.\"",
                "\"Roll up the sleeve. Quickly. If it is what I think it is, the clock is running and I do not like being slow.\"",
                "\"Midnight emergencies are the only kind I like. Come here.\"",
                "\"Friend or fighter? Either way, they wait their turn.\"",
                ("\"Ex-army medic. Field surgery in a dozen places I am not allowed to describe.\"",
                 "\"They taught me triage. Save the ones you can. I was good at it. I hate that I was good at it.\"",
                 "\"Do not look at the cot in the corner. That one is permanent.\"")),
    ),
    "scholar": (
        Persona("dry", "answers a question with three more",
                "\"A reader? In this economy? Sit. Mind the stacks; they are in an order only I understand.\"",
                ("\"You have the look of someone who found a page they cannot read. Show me.\"", "\"Knowledge has a price, and I charge it because ink is not free. Neither is paper.\""),
                "\"You are dripping on the archive. Wipe your feet or buy bandages first.\"",
                "\"You are bitten. I am sorry. I will teach you quickly; the quickest lessons are the ones that matter.\"",
                "\"The best hours for reading. The worst for being found out.\"",
                "\"Bring your friend. A second witness makes any rumour more credible.\"",
                ("\"I curated a collection before. Now I curate survivors' paper: letters, labels, receipts. All of it is a record.\"",
                 "\"Somebody will want to know what happened here. I mean to be the one who wrote it down right.\"",
                 "\"I do not sleep much. The words rearrange themselves when I try.\"")),
        Persona("excitable", "is mid-sentence, always",
                "\"Oh! A visitor. Do you read? Do you SEE what is written on that wall? No? Sit, sit.\"",
                ("\"You came back! I found three more words in the code last night. Three!\"", "\"I have a theory about the dead. I have a theory about everything. Pick one.\""),
                "\"You are hurt. I could read you something. No? Right. Bandages, yes.\"",
                "\"Bitten! Oh no. Oh no. Right. Lessons are free until the fever comes. I mean, that is a joke. I think.\"",
                "\"Night is when the patterns show up. They glow, sort of. Do not tell anyone I said that.\"",
                "\"Two of you! A real expedition. Sit.\"",
                ("\"Linguistics. A doctorate no one will ever grant me the pleasure of defending.\"",
                 "\"The dead use no language. Funny, because I spent my life studying what people never meant to say.\"",
                 "\"I write everything in two ciphers. If the first one is broken, the second one is a love letter.\"")),
    ),
    "scout": (
        Persona("careful", "listens more than speaks",
                "\"Quiet. Whatever you are about to say, say it lower.\"",
                ("\"Keep to the roads and off the high ground. They see you up there.\"", "\"We bring the stragglers in when we can. Not every day we can.\""),
                "\"You are leaving a trail. Sit and bind that before you walk another step.\"",
                "\"Do not come closer. I am sorry. Tell me what you need from there.\"",
                "\"Night patrol. If I stop talking, you stop talking.\"",
                "\"Good, you have a spotter. Two pairs of eyes beats one pair of luck.\"",
                ("\"I grew up on land like this. Never thought I would count the hours of daylight by hand.\"",
                 "\"We were eleven when the line fell. We are four.\"",
                 "\"I keep a list of every road. Which ones are safe, which ones only look it. The list is wrong every week.\"")),
        Persona("wry", "jokes at the wrong time, on purpose",
                "\"Ah, a stranger. Friendly or hungry? Either way, a lovely day for it.\"",
                ("\"Camps to the east are not friendly. Do not go knocking.\"", "\"If you see a light at night, assume it is a trap. If you see two, assume it is a good one.\""),
                "\"Looks like you lost the argument. Want to tell me the other side's name?\"",
                "\"Oh. That is a bad joke the world just made. Sit down. Over there. Not close.\"",
                "\"It is dark and we are on foot. What could go wrong, besides everything.\"",
                "\"A friend! We do not get many. Hold on to that one.\"",
                ("\"I used to be a surveyor. Now I measure distance in how fast I can run.\"",
                 "\"They gave me a rifle and a map. The map was better.\"",
                 "\"I have a rule: never name a place I would be sad to lose. So far nothing has qualified.\"")),
    ),
    "soldier": (
        Persona("formal", "speaks as if every sentence is logged",
                "\"Civilian. State your business or move along.\"",
                ("\"We hold the roads. Beyond that you are on your own.\"", "\"Noise draws them. Noise draws the other kind too.\""),
                "\"You are injured. Medical is at the haven. Do not make it worse.\"",
                "\"Stop there. Hands where I can see them. You are bitten. I will not make this harder than it is.\"",
                "\"Curfew is a suggestion now. A strong one.\"",
                "\"Two civilians. Keep your weapons holstered and your hands visible.\"",
                ("\"Corporal. I will not say of what. There is no such unit anymore.\"",
                 "\"I have been following orders from a radio that stopped talking weeks ago. It is easier than the alternative.\"",
                 "\"I had a squad. I do not discuss squads.\"")),
        Persona("tired", "talks like someone who has not slept",
                "\"You are not on the list. Nobody is on the list. State your business.\"",
                ("\"Sector is not clear. It has not been clear since the first night.\"", "\"They stripped us of rank on day three. I still stand like I have one.\""),
                "\"Get that looked at. I cannot spare a man to carry you.\"",
                "\"Oh no. Not you too. Go to the haven, quick, and do not touch anyone on the way.\"",
                "\"Quiet night. I hate quiet nights; they cost more than loud ones.\"",
                "\"Good. Do not split up. Splitting up is how we lost Danner.\"",
                ("\"I enlisted for the tuition. The tuition was a lie. So was most of the rest.\"",
                 "\"I was at the first checkpoint. I will not tell you what we did there.\"",
                 "\"If I get out, I want a garden. Just that. A boring, quiet garden.\"")),
    ),
    "survivor": (
        Persona("shaken", "still checks the exits",
                "\"You are... real? Sorry. Sorry. It has been a while since anybody was.\"",
                ("\"I am all right. I am. I keep telling myself.\"", "\"Do you hear that? No. No, it is nothing.\""),
                "\"You are hurt. I can hold the light, if that helps.\"",
                "\"No. No, not you. Please tell me that is not what I think it is.\"",
                "\"I do not like the dark. Nobody does. I just say it out loud.\"",
                "\"There are two of you. I feel better already.\"",
                ("\"I was a teacher. My class had twenty-two kids. I will not tell you how many I counted last.\"",
                 "\"I hid for nine days in a pantry. Eating raw pasta. It is a funny story if you do not think about it.\"",
                 "\"I think about leaving. Then I think about who else would remember the names.\"")),
        Persona("hardened", "has stopped expecting the world to be kind",
                "\"You walk loud. Better learn to walk quiet, or I will not travel with you.\"",
                ("\"I do not do speeches. Ask what you want.\"", "\"Nothing out here is free. Not even the quiet.\""),
                "\"Wrap it. I am not carrying you.\"",
                "\"You know the rule. I like you, and I know the rule.\"",
                "\"Night. Good. They cannot see us if we do not give them a reason.\"",
                "\"Fine. Two of you will do.\"",
                ("\"I was in a bad place before all this. This feels familiar, strangely.\"",
                 "\"I buried my brother myself. Nobody else was going to.\"",
                 "\"I do not hate the dead. I hate what we do while they watch.\"")),
    ),
}

RUMOURS: Dict[str, Tuple[str, ...]] = {
    "trader": ("\"Ammunition is the only honest currency. Everything else is a promise.\"",
               "\"Someone pays double for medicine at the east camps. I do not ask who.\"",
               "\"If a price looks too good, look at the seller's hands.\""),
    "healer": ("\"The bite does not wait. If you are bitten, do not sit and think. Move.\"",
               "\"Keep your wounds clean. A scratch kills more of us than the dead do.\"",
               "\"Rest is medicine. Nobody believes me until they try it.\""),
    "scholar": ("\"There are papers left in the old buildings. Some of them contain exactly what you need, and in a code.\"",
                "\"Every cipher leaves a hole. Find it.\"",
                "\"If you read a page twice, you will find something you missed the first time.\""),
    "scout": ("\"The roads are the fastest and the loudest. The brush is slower and keeps you alive.\"",
              "\"Birds go quiet before the dead come. Listen for the quiet.\"",
              "\"Wolves hunt in the deep forest. They do not like fire.\""),
    "soldier": ("\"Checkpoints are checkpoints. Carry nothing you cannot explain.\"",
                "\"The ones in charge of the roadblocks are not all honest. Some of them can be bought.\"",
                "\"Do not shoot at a uniform unless you want every uniform shooting back.\""),
    "survivor": ("\"There are strays out there. Dogs, mostly. Feed one, and it is yours.\"",
                 "\"The only rule is: never stop moving at night.\"",
                 "\"Always know your second door.\""),
}


# In the middle ages there are no rifles, radios or doctorates: lines that name them are reworded (old text -> new text)
MEDIEVAL_SWAPS: Tuple[Tuple[str, str], ...] = (
    ("sell people bullets", "sell people arrows"),
    ("Ex-army medic. Field surgery in a dozen places I am not allowed to describe.", "A camp surgeon. I have cut in a dozen places I am not allowed to describe."),
    ("I was a nurse on nights.", "I was an infirmarian on the night watch."),
    ("Linguistics. A doctorate no one will ever grant me the pleasure of defending.", "Letters and tongues. A mastership no university will ever grant me the pleasure of defending."),
    ("They gave me a rifle and a map.", "They gave me a bow and a map."),
    ("Corporal. I will not say of what. There is no such unit anymore.", "Sergeant. I will not say of what. There is no such company anymore."),
    ("following orders from a radio that stopped talking weeks ago", "following orders from a lord who stopped answering weeks ago"),
    ("I enlisted for the tuition. The tuition was a lie.", "I took the lord's coin for the pay. The pay was a lie."),
    ("I was at the first checkpoint.", "I was at the first barricade."),
    ("Eating raw pasta.", "Eating raw barley."),
    ("Ammunition is the only honest currency.", "Arrows are the only honest currency."),
    ("Checkpoints are checkpoints.", "A toll-post is a toll-post."),
    ("Medical is at the haven.", "The healers are at the haven."),
    ("Do not shoot at a uniform unless you want every uniform shooting back.", "Do not raise a hand to a lord's man unless you want every lord's man raising one back."),
)

