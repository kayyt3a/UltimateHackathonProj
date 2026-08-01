"""Marv's navigation network.

24 ultrasonic sensor readings in, one of four movement classes out.

    input_layer      → ReLU
    navigation_layer → ReLU
    output_layer

The layer widths are not recorded in this file. Marv's surviving checkpoint is
the only remaining record of how wide his network is at each stage, so the
sizes must be supplied when the model is constructed.
"""

import torch.nn as nn


NUM_SENSORS = 24
NUM_MOVEMENTS = 4


class MarvNavigationModel(nn.Module):
    def __init__(self, navigation_in_features, navigation_out_features):
        super().__init__()
        self.input_layer = nn.Linear(NUM_SENSORS, navigation_in_features)
        self.navigation_layer = nn.Linear(navigation_in_features, navigation_out_features)
        self.output_layer = nn.Linear(navigation_out_features, NUM_MOVEMENTS)
        self.relu = nn.ReLU()

    def forward(self, x):
        x = self.relu(self.input_layer(x))
        x = self.relu(self.navigation_layer(x))
        return self.output_layer(x)
