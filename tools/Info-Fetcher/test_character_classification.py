#!/usr/bin/env python3
"""
Test script for character classification using Gemini API

This script tests the enhanced character classification system that uses
Google's Gemini API to determine main/alt status of characters.
"""

import os
import json
from wow_guild_fetcher import WoWGuildFetcher
import asyncio

# API credentials
CLIENT_ID = "3298680df4b94d1ca55beeaf7643951d"
CLIENT_SECRET = "efEB89iv5bBsgZLY6hoqXRiijcvAVQdE"
GEMINI_API_KEY = os.getenv('GEMINI_API_KEY')  # Get from environment variable

# Test cases with expected results
TEST_CASES = [
    {
        "name": "Mainchar",
        "level": 80,
        "class": "Warrior",
        "rank": 1,
        "note": "Guild Leader's main character",
        "expected": {"is_main": True, "is_alt": False}
    },
    {
        "name": "Altchar",
        "level": 80,
        "class": "Mage",
        "rank": 4,
        "note": "Alt of Mainchar",
        "expected": {"is_main": False, "is_alt": True, "main_name": "Mainchar"}
    },
    {
        "name": "Ambiguouschar",
        "level": 80,
        "class": "Priest",
        "rank": 3,
        "note": "Active raider",
        "expected": None  # Let Gemini decide
    }
]

async def test_character_classification():
    """Test character classification with both regex and Gemini approaches"""
    print("🧪 Testing Character Classification System")
    print("=" * 50)
    
    # Initialize fetcher with Gemini
    fetcher = WoWGuildFetcher(
        CLIENT_ID, 
        CLIENT_SECRET, 
        "TestGuild", 
        "TestRealm",
        gemini_api_key=GEMINI_API_KEY
    )
    
    # Process each test case
    for case in TEST_CASES:
        print(f"\nTesting character: {case['name']}")
        print("-" * 30)
        
        # Create test data structures
        character = {
            "name": case["name"],
            "level": case["level"],
            "playable_class": {"name": case["class"]}
        }
        
        member = {
            "character": character,
            "rank": case["rank"],
            "note": case["note"]
        }
        
        # Extract notes using recursive search
        notes = fetcher.extract_notes_recursively(member)
        
        # Test regex-based detection
        print("\nTesting regex-based detection:")
        regex_result = fetcher.detect_main_alt_status(notes, character, member, None)
        print(f"Result: {json.dumps(regex_result, indent=2)}")
        
        if case["expected"]:
            for key, expected_value in case["expected"].items():
                if key in regex_result:
                    actual_value = regex_result[key]
                    if actual_value == expected_value:
                        print(f"✅ {key}: {actual_value} (matches expected)")
                    else:
                        print(f"❌ {key}: {actual_value} (expected {expected_value})")
        
        # Test Gemini-based detection
        if fetcher.gemini_model:
            print("\nTesting Gemini-based detection:")
            try:
                gemini_result = await fetcher.gemini_detect_status(
                    case["name"],
                    case["rank"],
                    case["note"],
                    character
                )
                print(f"Result: {json.dumps(gemini_result, indent=2)}")
                
                if case["expected"]:
                    for key, expected_value in case["expected"].items():
                        if key in gemini_result:
                            actual_value = gemini_result[key]
                            if actual_value == expected_value:
                                print(f"✅ {key}: {actual_value} (matches expected)")
                            else:
                                print(f"❌ {key}: {actual_value} (expected {expected_value})")
                
                # Print Gemini's reasoning
                if "reasoning" in gemini_result:
                    print(f"\nGemini's reasoning: {gemini_result['reasoning']}")
                
                # Print confidence score
                if "confidence" in gemini_result:
                    print(f"Confidence: {gemini_result['confidence']:.2f}")
                
            except Exception as e:
                print(f"❌ Gemini API error: {str(e)}")
        else:
            print("\n⚠️ Gemini API not configured - skipping Gemini tests")

if __name__ == "__main__":
    print("Character Classification Test Suite")
    print("=" * 50)
    
    if not GEMINI_API_KEY:
        print("⚠️ GEMINI_API_KEY not found in environment variables")
        print("Gemini-based classification will be skipped")
        print("Set the GEMINI_API_KEY environment variable to enable Gemini tests")
    
    asyncio.run(test_character_classification())
