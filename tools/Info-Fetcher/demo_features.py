#!/usr/bin/env python3
"""
Demo script to showcase the enhanced features of WoW Guild Info Fetcher

This script demonstrates:
1. Gemini AI character classification
2. Improved class distribution filtering
3. Level 80 character filtering
"""

import os
import asyncio
from wow_guild_fetcher import WoWGuildFetcher
import pandas as pd
import json

# Sample test data
TEST_CHARACTERS = [
    {
        "name": "Thunderfury",
        "level": 80,
        "class": "Warrior",
        "rank": 1,
        "note": "Guild leader's main character, raid leader",
    },
    {
        "name": "Thunderstorm",
        "level": 80,
        "class": "Shaman",
        "rank": 3,
        "note": "Alt of Thunderfury",
    },
    {
        "name": "Shadowblade",
        "level": 80,
        "class": "Rogue",
        "rank": 2,
        "note": "Main raider, officer",
    },
    {
        "name": "Lightbringer",
        "level": 80,
        "class": "Paladin",
        "rank": 4,
        "note": "Alt character for healing",
    },
    {
        "name": "Newbie",
        "level": 45,
        "class": "Mage",
        "rank": 5,
        "note": "Leveling character",
    }
]

async def demo_character_classification():
    """Demonstrate character classification with Gemini AI"""
    print("\n🧪 Testing Character Classification")
    print("=" * 50)
    
    # Initialize fetcher with Gemini if available
    gemini_key = os.getenv('GEMINI_API_KEY')
    fetcher = WoWGuildFetcher(
        "test-id", "test-secret", "TestGuild", "TestRealm",
        gemini_api_key=gemini_key
    )
    
    for char in TEST_CHARACTERS:
        print(f"\nAnalyzing character: {char['name']}")
        print("-" * 30)
        
        # Create test data structures
        character = {
            "name": char["name"],
            "level": char["level"],
            "playable_class": {"name": char["class"]}
        }
        
        member = {
            "character": character,
            "rank": char["rank"],
            "note": char["note"]
        }
        
        # Extract notes
        notes = fetcher.extract_notes_recursively(member)
        
        # Try Gemini classification first
        if fetcher.gemini_model:
            print("\nGemini AI Analysis:")
            try:
                gemini_result = await fetcher.gemini_detect_status(
                    char["name"],
                    char["rank"],
                    char["note"],
                    character
                )
                print(f"Result: {json.dumps(gemini_result, indent=2)}")
            except Exception as e:
                print(f"Gemini API error: {str(e)}")
        
        # Fallback/traditional analysis
        print("\nTraditional Analysis:")
        result = fetcher.detect_main_alt_status(notes, character, member, None)
        print(f"Result: {json.dumps(result, indent=2)}")

def demo_class_distribution():
    """Demonstrate improved class distribution analysis"""
    print("\n📊 Testing Class Distribution")
    print("=" * 50)
    
    # Convert test data to DataFrame
    df = pd.DataFrame(TEST_CHARACTERS)
    
    print("\nAll Characters:")
    print(df[['name', 'level', 'class', 'rank']])
    
    print("\nLevel 80 Characters:")
    max_level_df = df[df['level'] >= 80]
    print(max_level_df[['name', 'level', 'class', 'rank']])
    
    # Class distribution
    class_counts = max_level_df['class'].value_counts()
    print("\nClass Distribution (Level 80):")
    print(class_counts)
    
    # Role distribution
    role_mapping = {
        'Warrior': 'Tank/DPS',
        'Paladin': 'Tank/Healer/DPS',
        'Rogue': 'DPS',
        'Shaman': 'Healer/DPS',
        'Mage': 'DPS'
    }
    
    max_level_df['roles'] = max_level_df['class'].map(role_mapping)
    print("\nRole Distribution (Level 80):")
    roles = {
        'Tank': len(max_level_df[max_level_df['roles'].str.contains('Tank', na=False)]),
        'Healer': len(max_level_df[max_level_df['roles'].str.contains('Healer', na=False)]),
        'DPS': len(max_level_df[max_level_df['roles'].str.contains('DPS', na=False)])
    }
    print(json.dumps(roles, indent=2))

async def main():
    print("🎮 WoW Guild Info Fetcher Demo")
    print("=" * 50)
    
    # Check Gemini availability
    gemini_key = os.getenv('GEMINI_API_KEY')
    if gemini_key:
        print("✅ Gemini AI enabled")
    else:
        print("⚠️ Gemini AI not configured")
        print("Some features will use fallback methods")
    
    # Demo character classification
    await demo_character_classification()
    
    # Demo class distribution
    demo_class_distribution()
    
    print("\n🎉 Demo complete!")
    print("\nNext steps:")
    print("1. Run the full test suite: python setup_and_test.py")
    print("2. Launch the dashboard: python main.py --dashboard")
    print("3. Generate reports: python main.py --max-level-only --use-gemini")

if __name__ == "__main__":
    asyncio.run(main())
