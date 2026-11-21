from .core import catalog, run_trace, resolve
from . import sequences, dynamic, graphs, trees, multiway, advanced, foundations

# The reviewed English presentation names are also identities, not just labels.
# Keep routing and display metadata together so an English course does not
# unnecessarily generate and verify a new implementation of a known algorithm.
from .core import REGISTRY
from .i18n import localize_text, HAN

for _profile in REGISTRY.values():
    _english = localize_text(_profile['title'], 'en')
    if _english and not HAN.search(_english):
        _profile['aliases'] = list(dict.fromkeys([
            *_profile['aliases'], _english, _english.replace('-', ' '),
        ]))
