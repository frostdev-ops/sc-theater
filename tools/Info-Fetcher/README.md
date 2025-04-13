# WoW Guild Info Fetcher

A comprehensive tool for fetching and analyzing World of Warcraft guild data, featuring intelligent character classification using Google's Gemini AI.

## Features

- Fetch guild roster, achievements, and raid progress
- Smart character classification (main/alt detection)
- Class distribution analysis with filtering
- Interactive dashboard
- HTML and Excel report generation
- Level 80 character filtering
- Activity tracking

## Installation

1. Clone the repository:
```bash
git clone <repository-url>
cd tools/Info-Fetcher
```

2. Install dependencies:
```bash
python setup_and_test.py
```

## Configuration

The application uses environment variables for configuration, which can be set in a `.env` file:

### Environment Variables

1. Create a `.env` file in the project root:
```bash
cp .env.example .env  # Copy example config
nano .env             # Edit with your settings
```

2. Configure the following settings:

```ini
# Blizzard API Credentials
BLIZZARD_CLIENT_ID="your-client-id"
BLIZZARD_CLIENT_SECRET="your-client-secret"

# Google Gemini API (Optional)
GEMINI_API_KEY="your-gemini-api-key"

# Default Guild Settings
DEFAULT_GUILD_NAME="Your Guild"
DEFAULT_REALM="YourRealm"
DEFAULT_REGION="us"

# Dashboard Settings
STREAMLIT_PORT=8501
STREAMLIT_ENABLE_CORS=false
STREAMLIT_ENABLE_XSRF_PROTECTION=true
STREAMLIT_SERVER_ADDRESS="localhost"
STREAMLIT_GATHER_USAGE_STATS=false

# Application Settings
MAX_LEVEL=80
DEFAULT_ACTIVE_DAYS=60
CACHE_DURATION_HOURS=12
```

### API Keys

1. **Blizzard API**: 
   - Get your API credentials from the [Blizzard Developer Portal](https://develop.battle.net/)
   - Add them to your `.env` file

2. **Google Gemini API** (Optional):
   - Get an API key from [Google AI Studio](https://makersuite.google.com/app/apikey)
   - Add it to your `.env` file

## Usage

### Basic Usage

```bash
python main.py --guild "Guild Name" --realm "Realm Name"
```

### Advanced Options

```bash
# Use Gemini AI for character classification
python main.py --use-gemini

# Filter for max level characters only
python main.py --max-level-only

# Show only active characters (last 60 days)
python main.py --active-only

# Filter by specific classes
python main.py --classes "Warrior,Mage,Priest"

# Show only main characters
python main.py --main-only

# Launch interactive dashboard
python main.py --dashboard
```

### Testing

Run the test suite:
```bash
python setup_and_test.py
```

## Character Classification

The tool uses multiple methods to classify characters as mains or alts:

1. **Gemini AI Analysis** (if enabled):
   - Analyzes character names, ranks, and notes
   - Provides confidence scores and reasoning
   - Handles ambiguous cases intelligently

2. **Traditional Analysis**:
   - Note keyword matching (e.g., "alt of", "main")
   - Guild rank consideration
   - Level-based heuristics

3. **Fallback Methods**:
   - Level 80 characters with high ranks (0-2) are likely mains
   - Similar character names may indicate alts

## Class Distribution

The class distribution analysis now includes:

- Filtering for level 80 characters only
- Validation against known WoW classes
- Role distribution (Tank/Healer/DPS)
- Interactive visualization in the dashboard
- Class-specific color coding

## Dashboard Features

The interactive dashboard (`wow_guild_dashboard.py`) provides:

1. **Guild Overview**:
   - Member count
   - Achievement points
   - Raid progress

2. **Character Analysis**:
   - Main/alt relationships
   - Class distribution
   - Role distribution
   - Activity metrics

3. **Filtering Options**:
   - Level filtering
   - Class filtering
   - Activity filtering
   - Main/alt filtering

## Report Generation

Generate detailed reports in multiple formats:

```bash
# Generate all reports
python main.py

# Generate only HTML report
python main.py --reports-only

# Fetch data without generating reports
python main.py --fetch-only
```

## Troubleshooting

1. **Gemini API Issues**:
   - Verify API key is set correctly
   - Check for rate limiting
   - Review error messages in logs

2. **Class Distribution Issues**:
   - Ensure character data includes valid class names
   - Check level filtering settings
   - Verify API response format

3. **Dashboard Issues**:
   - Check Streamlit installation
   - Verify port 8501 is available
   - Check .streamlit/config.toml settings

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Submit a pull request

## License

This project is licensed under the MIT License - see the LICENSE file for details.
