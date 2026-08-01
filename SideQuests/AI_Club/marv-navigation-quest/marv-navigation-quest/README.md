# Marv's Damaged Navigation Layer

Marv is a wall-following robot. His twenty-four ultrasonic sensors are fine. His
motors are fine. What is not fine is his navigation network: a power surge wiped
one internal layer clean out of his checkpoint, and Marv has been sitting in the
corridor ever since, unable to decide which way to turn.

Everything else about him survived. The layer that is gone is called
`navigation_layer`.

## Your task

Rebuild the missing layer, then tell Marv where to go.

1. Reconstruct `navigation_layer` so Marv's network works again.
2. Run his nine remaining sensor readings through the repaired network.
3. Enter the nine movements, in order, on the quest website.

The site will tell you whether Marv's navigation is restored. It is all-or-
nothing: nine correct movements, or nothing.

## The one rule

**Only `navigation_layer` may be trained.** Every other parameter Marv still has
is the real thing, tuned over a long robotic career, and it must come through
your repair completely untouched. Retraining the whole network is not a repair —
it is a replacement, and it will not count even if the route comes out right.

Your notebook must show that you honoured this. The final cell of the starter
notebook prints the proof automatically; keep its output visible.

## What you have

| File | What it is |
|---|---|
| `model.py` | Marv's architecture |
| `damaged_model_state_dict.pt` | Everything that survived the surge |
| `training_data.npz` | 3,556 labelled readings (`X_train`, `y_train`) |
| `validation_data.npz` | 825 more, to check yourself (`X_validation`, `y_validation`) |
| `route_inputs.npz` | Marv's nine unseen readings (`X_route_inputs`) |
| `movement_mapping.json` | Which class index means which movement |
| `starter_notebook.ipynb` | Somewhere to begin |

The sensor readings are already scaled — feed them to the network as they are.

The four movements are `Move-Forward`, `Slight-Right-Turn`, `Sharp-Right-Turn`
and `Slight-Left-Turn`.

## Getting started

Upload the whole folder to Google Colab and open `starter_notebook.ipynb`. A CPU
runtime is plenty; you will not need a GPU. The stock Colab environment already
has everything you need.

A word of warning before you start writing training code: **look at what is
actually inside `damaged_model_state_dict.pt` first.** Marv's checkpoint is not
a complete one, and neither `model.py` nor this brief will tell you the shape of
what is missing. The checkpoint itself is the only surviving record.

## When you are done

Show a marker:

1. The website showing **Marv's navigation has been restored!**
2. Your notebook's final summary block.
3. That the route in your notebook matches what you typed into the site.

Good luck. Marv has been staring at the same wall for some time now.
