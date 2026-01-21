"""
Pytest configuration for driver tests
"""

import sys
from pathlib import Path

# Add drivers directory to path for imports
drivers_dir = Path(__file__).parent.parent
sys.path.insert(0, str(drivers_dir))
