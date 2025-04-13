#!/usr/bin/env python3
"""
Dashboard Data Inspector and Debug Tool

This script helps inspect and debug the data used by the WoW Guild Dashboard.
It loads the saved JSON data files and provides a summary of their contents.

Usage:
  python dashboard_debug.py
"""

import os
import json
import pandas as pd
from datetime import datetime
import sys

def load_json(file_path):
    """Load JSON file with error handling"""
    try:
        with open(file_path, 'r', encoding='utf-8') as f:
            return json.load(f)
    except Exception as e:
        print(f"❌ Error loading {file_path}: {str(e)}")
        return None

def analyze_structure(data, path="", max_depth=3, current_depth=0):
    """Analyze the structure of a complex data object"""
    if current_depth > max_depth:
        return f"(max depth reached)"
    
    if isinstance(data, dict):
        if len(data) == 0:
            return "{}"
        result = "{\n"
        for k, v in data.items():
            if isinstance(v, (dict, list)) and len(str(v)) > 100:
                result += f"{' ' * (current_depth + 2)}{k}: {analyze_structure(v, f'{path}.{k}', max_depth, current_depth + 1)}\n"
            else:
                result += f"{' ' * (current_depth + 2)}{k}: {type(v).__name__}{' (' + str(len(v)) + ' items)' if isinstance(v, (list, dict)) else ''}\n"
        result += f"{' ' * current_depth}}}"
        return result
    
    elif isinstance(data, list):
        if len(data) == 0:
            return "[]"
        if len(data) > 5:
            first_item = data[0]
            if isinstance(first_item, (dict, list)):
                result = f"[{len(data)} items, first item: {analyze_structure(first_item, f'{path}[0]', max_depth, current_depth + 1)}]"
            else:
                result = f"[{len(data)} items, first few: {data[:3]}...]"
        else:
            result = "[\n"
            for i, item in enumerate(data):
                if isinstance(item, (dict, list)):
                    result += f"{' ' * (current_depth + 2)}{analyze_structure(item, f'{path}[{i}]', max_depth, current_depth + 1)}\n"
                else:
                    result += f"{' ' * (current_depth + 2)}{type(item).__name__}: {item}\n"
            result += f"{' ' * current_depth}]"
        return result
    
    else:
        return f"{type(data).__name__}: {data}"

def main():
    print("🔍 WoW Guild Dashboard Data Inspector")
    print("=" * 50)
    
    # Load all data files
    data_dir = 'guild_data'
    
    if not os.path.exists(data_dir):
        print(f"❌ Data directory not found: {data_dir}")
        sys.exit(1)
    
    # Load main report
    report_file = os.path.join(data_dir, 'shadow_company_report.json')
    report = load_json(report_file)
    
    if not report:
        print("❌ Main report not found or invalid. Cannot continue.")
        sys.exit(1)
    
    print("\n📊 Guild Report Summary")
    print(f"Guild: {report.get('guild_name', 'Unknown')}")
    print(f"Realm: {report.get('realm', 'Unknown')}")
    print(f"Faction: {report.get('faction', 'Unknown')}")
    print(f"Members: {report.get('member_count', 0)}")
    print(f"Active Members: {len(report.get('active_members', []))}")
    print(f"Generated: {report.get('report_generated', 'Unknown')}")
    print(f"Max Level: {report.get('max_level', 'Unknown')}")
    
    # Load and analyze roster
    roster_file = os.path.join(data_dir, 'roster.json')
    roster = load_json(roster_file)
    
    if roster:
        print("\n👥 Roster Analysis")
        members = roster.get('members', [])
        print(f"Total Characters: {len(members)}")
        
        # Analyze levels
        levels = {}
        for member in members:
            if 'character' in member and 'level' in member['character']:
                level = member['character']['level']
                levels[level] = levels.get(level, 0) + 1
        
        print("Level Distribution:")
        for level, count in sorted(levels.items(), reverse=True):
            print(f"  Level {level}: {count} characters")
        
        # Analyze classes
        classes = {}
        class_issues = []
        
        for i, member in enumerate(members):
            if 'character' not in member:
                continue
                
            character = member['character']
            if 'playable_class' not in character:
                class_issues.append(f"Character #{i} has no playable_class key")
                continue
            
            playable_class = character['playable_class']
            
            if isinstance(playable_class, dict) and 'name' in playable_class:
                class_name = playable_class['name']
            elif isinstance(playable_class, dict) and 'id' in playable_class:
                class_id = playable_class['id']
                class_name = f"Class ID: {class_id}"
            else:
                class_name = str(playable_class)
                class_issues.append(f"Character #{i} has unusual class format: {class_name}")
            
            classes[class_name] = classes.get(class_name, 0) + 1
        
        print("\nClass Distribution:")
        for class_name, count in sorted(classes.items(), key=lambda x: x[1], reverse=True):
            print(f"  {class_name}: {count} characters")
        
        if class_issues:
            print("\nClass Issues Found:")
            for issue in class_issues[:5]:  # Show just first 5
                print(f"  • {issue}")
            if len(class_issues) > 5:
                print(f"  ... and {len(class_issues) - 5} more issues")
    
    # Check active members data
    active_file = os.path.join(data_dir, 'active_members.json')
    active_members = load_json(active_file)
    
    if active_members:
        print("\n⏱ Active Members Analysis")
        print(f"Total Active Members: {len(active_members)}")
        
        # Analyze last login
        if active_members:
            days = {}
            for member in active_members:
                day = member.get('days_since_login', 'Unknown')
                days[day] = days.get(day, 0) + 1
            
            print("Days Since Login Distribution:")
            for day, count in sorted(days.items())[:10]:  # Show top 10
                print(f"  {day} days: {count} characters")
    
    # Raid Progress
    raid_file = os.path.join(data_dir, 'raid_progress.json')
    raid_progress = load_json(raid_file)
    
    if raid_progress:
        print("\n🏆 Raid Progress Analysis")
        print(f"Categories: {len(raid_progress)}")
        
        for category, achievements in raid_progress.items():
            completed = sum(1 for a in achievements if a.get('completed', False))
            total = len(achievements)
            percent = (completed / total) * 100 if total > 0 else 0
            print(f"  {category}: {completed}/{total} ({percent:.1f}%)")
    
    print("\n🔍 Dashboard Data Inspection Complete!")

if __name__ == "__main__":
    main()
