"""
Configuration module for WoW Guild Info Fetcher

This module loads environment variables from .env file and provides
configuration settings for the application.
"""

import os
from dotenv import load_dotenv

# Load environment variables from .env file
load_dotenv()

# Blizzard API Configuration
BLIZZARD_CLIENT_ID = os.getenv('BLIZZARD_CLIENT_ID', '3298680df4b94d1ca55beeaf7643951d')
BLIZZARD_CLIENT_SECRET = os.getenv('BLIZZARD_CLIENT_SECRET', 'efEB89iv5bBsgZLY6hoqXRiijcvAVQdE')

# Google AI Configuration
GEMINI_API_KEY = os.getenv('GEMINI_API_KEY')
GEMINI_MODEL = os.getenv('GEMINI_MODEL', 'gemini-pro')
GEMINI_TEMPERATURE = float(os.getenv('GEMINI_TEMPERATURE', '0.7'))
GEMINI_TOP_P = float(os.getenv('GEMINI_TOP_P', '0.8'))
GEMINI_TOP_K = int(os.getenv('GEMINI_TOP_K', '40'))
GEMINI_MAX_TOKENS = int(os.getenv('GEMINI_MAX_TOKENS', '2048'))

# Validate Gemini settings
def validate_gemini_config():
    """Validate Gemini AI configuration settings"""
    if GEMINI_API_KEY:
        if GEMINI_MODEL not in ['gemini-pro', 'gemini-pro-vision', 'gemini-2.0-flash-lite', 'gemini-2.0-pro-exp-02-05', 'gemini-2.0-flash']:
            print(f"⚠️ Warning: Invalid GEMINI_MODEL '{GEMINI_MODEL}', using default 'gemini-pro'")
        
        if not 0 <= GEMINI_TEMPERATURE <= 1:
            print(f"⚠️ Warning: GEMINI_TEMPERATURE {GEMINI_TEMPERATURE} out of range (0-1), using 0.7")
        
        if not 0 <= GEMINI_TOP_P <= 1:
            print(f"⚠️ Warning: GEMINI_TOP_P {GEMINI_TOP_P} out of range (0-1), using 0.8")
        
        if not 1 <= GEMINI_TOP_K <= 100:
            print(f"⚠️ Warning: GEMINI_TOP_K {GEMINI_TOP_K} out of range (1-100), using 40")
        
        if GEMINI_MAX_TOKENS < 1:
            print(f"⚠️ Warning: Invalid GEMINI_MAX_TOKENS {GEMINI_MAX_TOKENS}, using 2048")

# Default Guild Settings
DEFAULT_GUILD_NAME = os.getenv('DEFAULT_GUILD_NAME', 'Shadow Company')
DEFAULT_REALM = os.getenv('DEFAULT_REALM', 'Duskwood')
DEFAULT_REGION = os.getenv('DEFAULT_REGION', 'us')

# Dashboard Settings
STREAMLIT_PORT = int(os.getenv('STREAMLIT_PORT', '8501'))
STREAMLIT_ENABLE_CORS = os.getenv('STREAMLIT_ENABLE_CORS', 'false').lower() == 'true'
STREAMLIT_ENABLE_XSRF_PROTECTION = os.getenv('STREAMLIT_ENABLE_XSRF_PROTECTION', 'true').lower() == 'true'
STREAMLIT_SERVER_ADDRESS = os.getenv('STREAMLIT_SERVER_ADDRESS', 'localhost')
STREAMLIT_GATHER_USAGE_STATS = os.getenv('STREAMLIT_GATHER_USAGE_STATS', 'false').lower() == 'true'

# Application Settings
MAX_LEVEL = int(os.getenv('MAX_LEVEL', '80'))
DEFAULT_ACTIVE_DAYS = int(os.getenv('DEFAULT_ACTIVE_DAYS', '60'))
CACHE_DURATION_HOURS = int(os.getenv('CACHE_DURATION_HOURS', '12'))

def get_streamlit_config():
    """Get Streamlit configuration as a TOML-formatted string"""
    return f"""
[server]
port = {STREAMLIT_PORT}
enableCORS = {str(STREAMLIT_ENABLE_CORS).lower()}
enableXsrfProtection = {str(STREAMLIT_ENABLE_XSRF_PROTECTION).lower()}

[browser]
serverAddress = "{STREAMLIT_SERVER_ADDRESS}"
gatherUsageStats = {str(STREAMLIT_GATHER_USAGE_STATS).lower()}
"""

def validate_config():
    """Validate required configuration settings"""
    missing = []
    
    # Check required Blizzard API credentials
    if not BLIZZARD_CLIENT_ID or not BLIZZARD_CLIENT_SECRET:
        missing.append("Blizzard API credentials (BLIZZARD_CLIENT_ID, BLIZZARD_CLIENT_SECRET)")
    
    # Check optional Gemini API key and settings
    if GEMINI_API_KEY:
        validate_gemini_config()
    else:
        print("⚠️ GEMINI_API_KEY not set - Gemini AI features will be disabled")
    
    # Check other required settings
    if not DEFAULT_GUILD_NAME or not DEFAULT_REALM or not DEFAULT_REGION:
        missing.append("Default guild settings (DEFAULT_GUILD_NAME, DEFAULT_REALM, DEFAULT_REGION)")
    
    if missing:
        raise ValueError(f"Missing required configuration: {', '.join(missing)}")
    
    return True

def get_gemini_generation_config():
    """Get Gemini AI generation configuration"""
    return {
        'model': GEMINI_MODEL,
        'temperature': GEMINI_TEMPERATURE,
        'top_p': GEMINI_TOP_P,
        'top_k': GEMINI_TOP_K,
        'max_output_tokens': GEMINI_MAX_TOKENS,
    }

def print_config_info():
    """Print current configuration information"""
    print("\n📝 Configuration Information")
    print("=" * 50)
    
    print(f"Guild: {DEFAULT_GUILD_NAME} ({DEFAULT_REALM}-{DEFAULT_REGION})")
    print(f"Max Level: {MAX_LEVEL}")
    print(f"Active Days Threshold: {DEFAULT_ACTIVE_DAYS}")
    print(f"Cache Duration: {CACHE_DURATION_HOURS} hours")
    
    print("\nAPI Configuration:")
    print(f"Blizzard API: {'✅ Configured' if BLIZZARD_CLIENT_ID else '❌ Missing'}")
    print(f"Gemini AI: {'✅ Enabled' if GEMINI_API_KEY else '⚠️ Disabled'}")
    
    print("\nDashboard Settings:")
    print(f"Server: {STREAMLIT_SERVER_ADDRESS}:{STREAMLIT_PORT}")
    print(f"CORS Enabled: {STREAMLIT_ENABLE_CORS}")
    print(f"XSRF Protection: {STREAMLIT_ENABLE_XSRF_PROTECTION}")
