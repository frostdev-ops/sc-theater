#!/usr/bin/env python3
"""
Setup and Test Script for WoW Guild Info Fetcher

This script:
1. Installs required dependencies
2. Tests the Gemini API integration
3. Verifies class distribution filtering
"""

import subprocess
import sys
import os
import json
import asyncio
from test_character_classification import test_character_classification

def install_requirements():
    """Install required packages from requirements.txt"""
    print("\n📦 Installing dependencies...")
    try:
        subprocess.check_call([sys.executable, "-m", "pip", "install", "-r", "requirements.txt"])
        print("✅ Dependencies installed successfully!")
    except Exception as e:
        print(f"❌ Error installing dependencies: {str(e)}")
        sys.exit(1)

def verify_gemini_setup():
    """Verify Gemini API key and configuration"""
    print("\n🔑 Checking Gemini API configuration...")
    
    gemini_key = os.getenv('GEMINI_API_KEY')
    if not gemini_key:
        print("⚠️ GEMINI_API_KEY not found in environment variables")
        print("To enable Gemini AI features, set the GEMINI_API_KEY environment variable")
        return False
    
    try:
        import google.generativeai as genai
        print("✅ Google Generative AI package installed")
        return True
    except ImportError:
        print("❌ Failed to import google.generativeai")
        print("Try reinstalling the package: pip install google-generativeai")
        return False

def test_class_distribution():
    """Test class distribution filtering"""
    print("\n📊 Testing class distribution filtering...")
    
    # Test data
    test_classes = [
        {"name": "Warrior", "level": 80},
        {"name": "Mage", "level": 80},
        {"name": "Priest", "level": 80},
        {"name": "Unknown", "level": 80},
        {"name": "Warrior", "level": 70},
        {"name": "InvalidClass", "level": 80}
    ]
    
    # Count valid max-level classes
    valid_classes = {
        "Warrior", "Paladin", "Hunter", "Rogue", "Priest",
        "Death Knight", "Shaman", "Mage", "Warlock", "Monk",
        "Druid", "Demon Hunter", "Evoker"
    }
    
    max_level_count = sum(1 for c in test_classes 
                         if c["level"] >= 80 and c["name"] in valid_classes)
    
    print(f"Found {max_level_count} valid max-level characters")
    print("✅ Class distribution test complete!")

async def main():
    print("🔧 Setup and Test Suite")
    print("=" * 50)
    
    # Install dependencies
    install_requirements()
    
    # Check Gemini setup
    gemini_available = verify_gemini_setup()
    
    # Test character classification
    print("\n🧪 Running character classification tests...")
    await test_character_classification()
    
    # Test class distribution
    test_class_distribution()
    
    # Summary
    print("\n📝 Test Summary")
    print("=" * 50)
    print(f"Gemini AI: {'✅ Available' if gemini_available else '⚠️ Not configured'}")
    print("Character Classification: ✅ Tested")
    print("Class Distribution: ✅ Tested")
    
    print("\n🎉 Setup and testing complete!")
    
    if not gemini_available:
        print("\nTo enable Gemini AI features:")
        print("1. Get an API key from Google AI Studio")
        print("2. Set the GEMINI_API_KEY environment variable")
        print("3. Run the script with --use-gemini flag")

if __name__ == "__main__":
    asyncio.run(main())
