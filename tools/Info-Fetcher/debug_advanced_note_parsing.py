#!/usr/bin/env python3
"""
Advanced debugging tool for note parsing

This script implements multiple strategies for parsing guild notes
and detecting main/alt relationships with detailed logging.

Usage:
  python debug_advanced_note_parsing.py
"""

import json
import os
import re
import pandas as pd

def load_roster():
    """Load the roster data from file"""
    try:
        with open('guild_data/roster.json', 'r', encoding='utf-8') as f:
            return json.load(f)
    except Exception as e:
        print(f"Error loading roster: {e}")
        return None

def extract_notes_from_member(member, note_extraction_strategies):
    """Try multiple strategies to extract notes from a member"""
    results = {}
    
    for strategy_name, strategy_func in note_extraction_strategies:
        try:
            result = strategy_func(member)
            results[strategy_name] = result
        except:
            results[strategy_name] = None
    
    return results

def detect_main_alt_status(note_text):
    """Detect if a note indicates main or alt status"""
    if not note_text or not isinstance(note_text, str):
        return {'is_main': False, 'is_alt': False, 'main_name': None}
    
    note_lower = note_text.lower()
    
    # Detect alt status
    is_alt = any(keyword in note_lower for keyword in ['alt', 'alternative', 'twink', 'alts', 'alt of', 'alt:'])
    
    # Detect main status (but not if already detected as alt)
    is_main = False if is_alt else any(keyword in note_lower for keyword in ['main', 'primary', 'mains'])
    
    # Extract main name if this is an alt
    main_name = None
    if is_alt:
        patterns = [
            r'alt\s+of\s+([a-zA-Z]+)',
            r'alt[:\s]+([a-zA-Z]+)',
            r'alt[-_]\s*([a-zA-Z]+)',
            r'([a-zA-Z]+)[\'']s\s+alt',
            r'([a-zA-Z]+)\s+alt'
        ]
        
        for pattern in patterns:
            match = re.search(pattern, note_lower)
            if match:
                main_name = match.group(1).strip().capitalize()
                break
    
    return {
        'is_main': is_main,
        'is_alt': is_alt,
        'main_name': main_name
    }

def analyze_roster_notes():
    """Analyze all notes in the roster and report statistics"""
    roster = load_roster()
    if not roster or 'members' not in roster:
        print("No roster data found or roster is empty")
        return
    
    print(f"Analyzing notes for {len(roster['members'])} members")
    
    # Define note extraction strategies
    note_extraction_strategies = [
        ("Direct note", lambda m: m.get('note', '')),
        ("Officer note", lambda m: m.get('officer_note', '')),
        ("Character note", lambda m: m.get('character_note', '')),
        ("Public note", lambda m: m.get('public_note', ''))
    ]
    
    # Extract notes using all strategies
    members_with_extracted_notes = []
    
    for member in roster['members']:
        try:
            char_name = member.get('character', {}).get('name', 'Unknown')
            char_level = member.get('character', {}).get('level', 0)
            char_class = member.get('character', {}).get('playable_class', {}).get('name', 'Unknown')
            
            # Try all note extraction strategies
            notes = extract_notes_from_member(member, note_extraction_strategies)
            
            # Combine all non-empty notes for analysis
            combined_notes = ' '.join([note for note in notes.values() if note and isinstance(note, str)])
            
            # Analyze the combined notes
            status = detect_main_alt_status(combined_notes)
            
            members_with_extracted_notes.append({
                'Name': char_name,
                'Level': char_level,
                'Class': char_class,
                'Direct note': notes.get("Direct note", ""),
                'Officer note': notes.get("Officer note", ""),
                'Character note': notes.get("Character note", ""),
                'Public note': notes.get("Public note", ""),
                'Is Main': status['is_main'],
                'Is Alt': status['is_alt'],
                'Main Name': status['main_name']
            })
            
        except Exception as e:
            print(f"Error processing member: {e}")
    
    # Convert to DataFrame for analysis
    df = pd.DataFrame(members_with_extracted_notes)
    
    # Create output directory
    os.makedirs('debug_output', exist_ok=True)
    
    # Save full results to CSV
    df.to_csv('debug_output/note_analysis.csv', index=False)
    
    # Print statistics
    print("\nNote Extraction Results:")
    print(f"Total members: {len(df)}")
    
    # Count non-empty notes for each strategy
    for strategy in ["Direct note", "Officer note", "Character note", "Public note"]:
        non_empty = df[df[strategy].notna() & (df[strategy] != '')].shape[0]
        print(f"Members with non-empty {strategy}: {non_empty} ({non_empty/len(df)*100:.1f}%)")
    
    # Count main/alt detection
    main_count = df[df['Is Main']].shape[0]
    alt_count = df[df['Is Alt']].shape[0]
    with_main_name = df[df['Main Name'].notna() & (df['Main Name'] != '')].shape[0]
    
    print(f"Detected mains: {main_count} ({main_count/len(df)*100:.1f}%)")
    print(f"Detected alts: {alt_count} ({alt_count/len(df)*100:.1f}%)")
    print(f"Alts with main name: {with_main_name} ({with_main_name/alt_count*100:.1f}% of alts)" if alt_count > 0 else "No alts detected")
    
    # Print some examples
    print("\nSample Main characters:")
    for _, row in df[df['Is Main']].head(5).iterrows():
        print(f"  {row['Name']} (Level {row['Level']} {row['Class']})")
        print(f"    Note: '{row['Direct note']}'")
        print(f"    Officer Note: '{row['Officer note']}'")
    
    print("\nSample Alt characters:")
    for _, row in df[df['Is Alt']].head(5).iterrows():
        print(f"  {row['Name']} (Level {row['Level']} {row['Class']})")
        print(f"    Note: '{row['Direct note']}'")
        print(f"    Officer Note: '{row['Officer note']}'")
        print(f"    Main: {row['Main Name'] if row['Main Name'] else 'Unknown'}")
    
    print("\nNote analysis complete. Full results saved to debug_output/note_analysis.csv")

if __name__ == "__main__":
    print("🔍 Advanced Note Parsing Debug Tool")
    print("=" * 50)
    analyze_roster_notes()
