import streamlit as st
import pandas as pd
import json
import os
import plotly.express as px
import plotly.graph_objects as go
from datetime import datetime, timedelta
from wow_guild_fetcher import WoWGuildFetcher
from wow_guild_helpers import get_class_name_from_id, extract_notes_recursively, detect_main_alt_status, get_character_class_summary
from wow_guild_report import create_guild_report
from streamlit_echarts import st_echarts
import re

# Set page configuration
st.set_page_config(
    page_title="Shadow Company Dashboard",
    page_icon="🌑",
    layout="wide",
    initial_sidebar_state="expanded"
)

# Sidebar configuration
st.sidebar.title("🌑✨ Shadow Company ✨🌑")
st.sidebar.markdown("Guild Dashboard")

# API credentials
CLIENT_ID = "3298680df4b94d1ca55beeaf7643951d"
CLIENT_SECRET = "efEB89iv5bBsgZLY6hoqXRiijcvAVQdE"

# Guild information
GUILD_NAME = st.sidebar.text_input("Guild Name", "Shadow Company")
REALM = st.sidebar.text_input("Realm", "Area 52")
REGION = st.sidebar.selectbox("Region", ["us", "eu", "kr", "tw"], 0)

# Refresh button to fetch new data
refresh = st.sidebar.button("Refresh Data")

# Create directories if they don't exist
os.makedirs('guild_data', exist_ok=True)

# Constants
MAX_LEVEL = 80  # Updated to level 80
TWO_MONTHS_AGO = (datetime.now() - timedelta(days=60)).strftime('%Y-%m-%d')

# Function to check if data needs to be refreshed
def should_refresh_data():
    try:
        # Check if main report file exists and when it was last modified
        if os.path.exists('guild_data/shadow_company_report.json'):
            last_modified = os.path.getmtime('guild_data/shadow_company_report.json')
            last_modified_date = datetime.fromtimestamp(last_modified)
            now = datetime.now()
            
            # If file is less than 12 hours old, don't refresh unless button was clicked
            if (now - last_modified_date) < timedelta(hours=12) and not refresh:
                return False
        
        return True
    except:
        return True

# Function to load data from files or fetch new data
def load_or_fetch_data():
    if should_refresh_data():
        st.sidebar.info("Fetching fresh guild data... This may take a minute.")
        
        try:
            # Initialize the fetcher
            fetcher = WoWGuildFetcher(CLIENT_ID, CLIENT_SECRET, GUILD_NAME, REALM, REGION)
            
            # Generate complete report
            report = create_guild_report(fetcher, 'guild_data/shadow_company_report.json')
            
            # Generate specialized reports
            roster = fetcher.get_guild_roster()
            roster = fetcher.process_roster_data_without_gemini(roster)
            with open('guild_data/roster.json', 'w', encoding='utf-8') as f:
                json.dump(roster, f, indent=2)
            
            achievements = fetcher.get_guild_achievements()
            with open('guild_data/achievements.json', 'w') as f:
                json.dump(achievements, f, indent=2)
            
            # Raid progress is intentionally not being saved here as we don't want to display it
            
            active_members = fetcher.get_active_members()
            with open('guild_data/active_members.json', 'w') as f:
                json.dump(active_members, f, indent=2)
                
            st.sidebar.success("Data refreshed successfully!")
            
        except Exception as e:
            st.sidebar.error(f"Error fetching data: {str(e)}")
            if not os.path.exists('guild_data/shadow_company_report.json'):
                st.error("No data available. Please check your guild name, realm, and API credentials.")
                st.stop()
    
    # Load data from files
    try:
        with open('guild_data/shadow_company_report.json', 'r', encoding='utf-8') as f:
            report = json.load(f)
        
        with open('guild_data/roster.json', 'r', encoding='utf-8') as f:
            roster = json.load(f)
        
        with open('guild_data/achievements.json', 'r', encoding='utf-8') as f:
            achievements = json.load(f)
        
        # Try to load raid_progress but don't fail if it doesn't exist
        try:
            with open('guild_data/raid_progress.json', 'r', encoding='utf-8') as f:
                raid_progress = json.load(f)
        except:
            raid_progress = None
        
        with open('guild_data/active_members.json', 'r', encoding='utf-8') as f:
            active_members = json.load(f)
        
        return report, roster, achievements, raid_progress, active_members
    
    except Exception as e:
        st.error(f"Error loading data: {str(e)}")
        st.stop()

# Load data
report, roster, achievements, raid_progress, active_members = load_or_fetch_data()

# Get the raid_progress removed from the report
# (This is to remove the raid progress data from being displayed anywhere)
if 'raid_progress' in report:
    del report['raid_progress']

# Main page title
st.title(f"🌑✨ {report['guild_name']} ✨🌑")
st.markdown(f"*{report['realm']} ({report['faction']})*")

# Data last updated
st.markdown(f"*Data last updated: {report['report_generated']}*")

# Key metrics
col1, col2, col3 = st.columns(3)

with col1:
    st.metric("Total Members", report['member_count'])

with col2:
    active_count = len(active_members)
    st.metric("Active Members", active_count)

with col3:
    st.metric("Achievement Points", report['achievement_points'])

# Tabs for different sections - removed Raid Progress tab
tab1, tab2, tab3, tab4 = st.tabs(["Guild Roster", "Mains & Alts", "Class Distribution", "Activity Metrics"])

# Process roster data to identify mains and alts
def process_characters():
    processed_roster = []
    
    # Process roster data
    for member in roster.get('members', []):
        try:
            character = member['character']
            
            # Skip non-max level characters
            char_level = character.get('level', 0)
            if isinstance(char_level, str):
                try:
                    char_level = int(char_level)
                except:
                    char_level = 0
            
            # Get realm information
            realm = character.get('realm', {}).get('name', REALM)
            if isinstance(realm, dict) and 'name' in realm:
                realm = realm['name']
            
            # Extract notes
            note = member.get('note', '')
            officer_note = member.get('officer_note', '')
            
            # Determine if character is main or alt
            is_alt = member.get('is_alt', False)
            is_main = member.get('is_main', False)
            main_name = member.get('main_name', None)
            
            # Extract class information with better handling of different formats
            class_name = "Unknown"
            if 'playable_class' in character:
                if isinstance(character['playable_class'], dict):
                    if 'name' in character['playable_class']:
                        class_name = character['playable_class']['name']
                    elif 'id' in character['playable_class']:
                        # Map class ID to name using helper function
                        class_id = character['playable_class']['id']
                        class_name = get_class_name_from_id(class_id)
                elif isinstance(character['playable_class'], str):
                    class_name = character['playable_class']
                    
            # Validate class name against known classes
            valid_classes = {
                "Warrior", "Paladin", "Hunter", "Rogue", "Priest", 
                "Death Knight", "Shaman", "Mage", "Warlock", "Monk",
                "Druid", "Demon Hunter", "Evoker"
            }
            if class_name not in valid_classes:
                class_name = "Unknown"
            
            # Check for recent login in active members
            last_login = "Unknown"
            days_since_login = 999  # Default to a high number if unknown
            
            for active in active_members:
                if active.get('name') == character.get('name'):
                    last_login = active.get('last_login', "Unknown")
                    days_since_login = active.get('days_since_login', 999)
                    break
            
            # Make sure days_since_login is a number
            if not isinstance(days_since_login, (int, float)):
                try:
                    days_since_login = int(days_since_login)
                except:
                    days_since_login = 999
                    
            processed_roster.append({
                'Name': character.get('name', 'Unknown'),
                'Level': int(character.get('level', 0)),  # Ensure level is an integer
                'Class': class_name,
                'Realm': realm,
                'Rank': member.get('rank', 0),
                'Last Login': last_login,
                'Days Since Login': days_since_login,
                'Note': note,
                'Officer Note': officer_note,
                'Is Alt': is_alt,
                'Is Main': is_main,
                'Main Name': main_name,
                'Character Type': 'Alt' if is_alt else ('Main' if is_main else 'Unspecified')
            })
        except Exception as e:
            st.error(f"Error processing character: {str(e)}")
            continue
    
    # Convert to DataFrame
    roster_df = pd.DataFrame(processed_roster)
    
    # Define rank names
    rank_names = {
        0: "Preceptor",
        1: "Justicar",
        2: "Adjutant", 
        3: "Sentinel",
        4: "Aspirant"
    }
    
    # Replace rank numbers with names
    if 'Rank' in roster_df.columns:
        roster_df['Rank'] = roster_df['Rank'].map(lambda x: rank_names.get(x, f"Rank {x}"))
    
    return roster_df

# Get processed roster dataframe
roster_df = process_characters()

# Tab 1: Guild Roster
with tab1:
    st.header("Guild Roster")
    
    # Default filtering options
    show_max_level_only = st.checkbox("Show only max level characters", value=True)
    show_recently_active = st.checkbox("Show only recently active characters (last 2 months)", value=True)
    
    # Advanced filtering
    with st.expander("Advanced Filters"):
        col1, col2, col3 = st.columns(3)
        
        with col1:
            class_filter = st.multiselect("Filter by Class", 
                                          options=sorted(roster_df['Class'].unique()),
                                          default=[])
        
        with col2:
            rank_filter = st.multiselect("Filter by Rank", 
                                         options=sorted(roster_df['Rank'].unique()),
                                         default=[])

        with col3:
            realm_filter = st.multiselect("Filter by Realm",
                                         options=sorted(roster_df['Realm'].unique()),
                                         default=[])
        
        with col1:
            character_type_filter = st.multiselect("Filter by Character Type",
                                                 options=["Main", "Alt", "Unspecified"],
                                                 default=[])
        
        with col2:
            min_level = st.slider("Minimum Level", min_value=1, max_value=MAX_LEVEL, value=1 if not show_max_level_only else MAX_LEVEL)
        
        with col3:
            max_days = st.slider("Max Days Since Login", min_value=1, max_value=365, value=60 if show_recently_active else 365)
    
    # Apply filters
    filtered_df = roster_df.copy()
    
    # Apply default filters with explicit checks
    if show_max_level_only:
        filtered_df = filtered_df[filtered_df['Level'] >= MAX_LEVEL]  # Change to >= for more robustness
    else:
        filtered_df = filtered_df[filtered_df['Level'] >= min_level]
        
    if show_recently_active:
        # Convert to numeric first to handle any string values
        filtered_df['Days Since Login'] = pd.to_numeric(filtered_df['Days Since Login'], errors='coerce')
        filtered_df = filtered_df[filtered_df['Days Since Login'] <= 60]
    else:
        filtered_df['Days Since Login'] = pd.to_numeric(filtered_df['Days Since Login'], errors='coerce')
        filtered_df = filtered_df[filtered_df['Days Since Login'] <= max_days]
    
    # Apply advanced filters
    if class_filter:
        filtered_df = filtered_df[filtered_df['Class'].isin(class_filter)]
    
    if rank_filter:
        filtered_df = filtered_df[filtered_df['Rank'].isin(rank_filter)]
        
    if realm_filter:
        filtered_df = filtered_df[filtered_df['Realm'].isin(realm_filter)]
        
    if character_type_filter:
        filtered_df = filtered_df[filtered_df['Character Type'].isin(character_type_filter)]
    
    # Sorting options
    sort_options = ["Name", "Level", "Class", "Realm", "Rank", "Days Since Login", "Character Type"]
    sort_by = st.selectbox("Sort by", sort_options)
    sort_order = st.radio("Sort Order", ["Ascending", "Descending"], horizontal=True)
    
    # Apply sorting
    if sort_by in filtered_df.columns:
        filtered_df = filtered_df.sort_values(
            by=sort_by, 
            ascending=(sort_order == "Ascending")
        )
    
    # Display table with colored rows based on character type
    if not filtered_df.empty:
        # Function to color rows based on character type
        def highlight_character_type(row):
            if row['Character Type'] == 'Main':
                return ['background-color: rgba(76, 175, 80, 0.2)'] * len(row)
            elif row['Character Type'] == 'Alt':
                return ['background-color: rgba(255, 152, 0, 0.2)'] * len(row)
            return [''] * len(row)
        
        # Columns to display
        display_cols = ['Name', 'Level', 'Class', 'Rank', 'Realm', 'Last Login', 'Days Since Login', 'Character Type']
        
        # Display table with styling
        st.dataframe(
            filtered_df[display_cols].style.apply(highlight_character_type, axis=1),
            use_container_width=True
        )
        
        st.info(f"Showing {len(filtered_df)} characters out of {len(roster_df)} total")
    else:
        st.info("No characters match the current filters")

# Tab 2: Mains & Alts
with tab2:
    st.header("Mains & Alts")
    
    # Debug info about notes
    with st.expander("Debug Note Information"):
        st.write("Examining note fields in roster data:")
        
        # Count how many members have each type of note
        note_counts = {
            'note': 0,
            'officer_note': 0,
            'non_empty_note': 0,
            'non_empty_officer_note': 0,
            'is_main': 0,
            'is_alt': 0,
            'has_main_name': 0
        }
        
        sample_notes = []
        
        for i, member in enumerate(roster.get('members', [])):
            # Count note presence
            if 'note' in member and member['note']:
                note_counts['note'] += 1
                if member['note'].strip():
                    note_counts['non_empty_note'] += 1
                    if len(sample_notes) < 5:
                        sample_notes.append({
                            'character': member.get('character', {}).get('name', 'Unknown'),
                            'note': member['note'],
                            'note_type': 'Character Note'
                        })
            
            if 'officer_note' in member and member['officer_note']:
                note_counts['officer_note'] += 1
                if member['officer_note'].strip():
                    note_counts['non_empty_officer_note'] += 1
                    if len(sample_notes) < 10 and len(sample_notes) >= 5:
                        sample_notes.append({
                            'character': member.get('character', {}).get('name', 'Unknown'),
                            'note': member['officer_note'],
                            'note_type': 'Officer Note'
                        })
            
            # Count main/alt flags
            if member.get('is_main', False):
                note_counts['is_main'] += 1
            
            if member.get('is_alt', False):
                note_counts['is_alt'] += 1
                if member.get('main_name'):
                    note_counts['has_main_name'] += 1
        
        # Display counts
        st.write("Note field statistics:")
        col1, col2 = st.columns(2)
        with col1:
            st.metric("Members with note field", note_counts['note'])
            st.metric("Members with non-empty note", note_counts['non_empty_note'])
            st.metric("Detected Main characters", note_counts['is_main'])
        
        with col2:
            st.metric("Members with officer note field", note_counts['officer_note'])
            st.metric("Members with non-empty officer note", note_counts['non_empty_officer_note'])
            st.metric("Detected Alt characters", note_counts['is_alt'])
            st.metric("Alts with Main name found", note_counts['has_main_name'])
        
        # Show sample notes
        if sample_notes:
            st.write("Sample notes found:")
            st.table(pd.DataFrame(sample_notes))
        else:
            st.warning("No sample notes found to display")
    
    # Group alts by their main
    main_alt_groups = {}
    
    for _, character in roster_df.iterrows():
        if character['Character Type'] == 'Main' or (character['Character Type'] == 'Unspecified' and character['Level'] == MAX_LEVEL):
            # This is a main or potential main
            main_name = character['Name']
            if main_name not in main_alt_groups:
                main_alt_groups[main_name] = {
                    'main': character,
                    'alts': []
                }
        elif character['Character Type'] == 'Alt' and character['Main Name']:
            # This is an alt with a specified main
            main_name = character['Main Name']
            if main_name not in main_alt_groups:
                main_alt_groups[main_name] = {
                    'main': None,
                    'alts': []
                }
            main_alt_groups[main_name]['alts'].append(character)
        elif character['Character Type'] == 'Alt':
            # This is an alt with an unspecified main
            main_name = 'Unspecified'
            if main_name not in main_alt_groups:
                main_alt_groups[main_name] = {
                    'main': None,
                    'alts': []
                }
            main_alt_groups[main_name]['alts'].append(character)
    
    # Display each main and their alts
    for main_name, group in main_alt_groups.items():
        if main_name != 'Unspecified':
            with st.expander(f"🔵 Main: {main_name}" + (f" ({group['main']['Class']} - Level {group['main']['Level']})" if group['main'] is not None else "")):
                if group['main'] is not None:
                    main_character = group['main']
                    st.markdown(f"**Class:** {main_character['Class']}")
                    st.markdown(f"**Level:** {main_character['Level']}")
                    st.markdown(f"**Rank:** {main_character['Rank']}")
                    
                    if len(group['alts']) > 0:
                        st.markdown("### Alts")
                        alt_data = []
                        for alt in group['alts']:
                            alt_data.append({
                                'Name': alt['Name'],
                                'Class': alt['Class'],
                                'Level': alt['Level'],
                                'Rank': alt['Rank'],
                                'Last Login': alt['Last Login']
                            })
                        if alt_data:
                            st.dataframe(pd.DataFrame(alt_data), use_container_width=True)
                    else:
                        st.markdown("*No alts found*")
                else:
                    st.markdown("*Main character not found in roster*")
    
    # Display alts without a specified main
    if 'Unspecified' in main_alt_groups and main_alt_groups['Unspecified']['alts']:
        with st.expander(f"⚠️ Alts without specified mains ({len(main_alt_groups['Unspecified']['alts'])})"):
            alt_data = []
            for alt in main_alt_groups['Unspecified']['alts']:
                alt_data.append({
                    'Name': alt['Name'],
                    'Class': alt['Class'],
                    'Level': alt['Level'],
                    'Rank': alt['Rank'],
                    'Last Login': alt['Last Login'],
                    'Note': alt['Note']
                })
            if alt_data:
                st.dataframe(pd.DataFrame(alt_data), use_container_width=True)

# Tab 3: Class Distribution
with tab3:
    st.header("Class Distribution")
    
    # Filter options
    show_only_max_level_class_dist = st.checkbox("Show only max level characters for class distribution", value=True)
    show_only_active_class_dist = st.checkbox("Show only recently active characters for class distribution", value=True)
    show_only_mains = st.checkbox("Show only main characters", value=False)
    
    # Calculate class distribution with our new helpers
    with st.spinner("Processing class distribution..."):
        # Create a class distribution data structure from the roster data for visualization
        if isinstance(roster, dict) and 'members' in roster:
            # Get the distribution from our helper function
            class_counts = get_character_class_summary(roster)
            
            # Convert to DataFrame for manipulation
            class_counts_df = pd.DataFrame(list(class_counts.items()), columns=['Class', 'Count'])
            
            # Filter based on user selections
            # This is handled manually since our helper only returns the raw counts
            if show_only_max_level_class_dist or show_only_active_class_dist or show_only_mains:
                # Create a filtered copy of the roster members for counting
                filtered_members = []
                
                for member in roster['members']:
                    if 'character' not in member:
                        continue
                        
                    # Apply level filter
                    if show_only_max_level_class_dist:
                        if member['character'].get('level', 0) < MAX_LEVEL:
                            continue
                    
                    # Apply active filter
                    if show_only_active_class_dist:
                        is_active = False
                        char_name = member['character'].get('name', '')
                        
                        for active in active_members:
                            if active.get('name') == char_name:
                                days = active.get('days_since_login', 999)
                                # Handle string values for days_since_login
                                if isinstance(days, str):
                                    try:
                                        days = int(days)
                                    except:
                                        days = 999
                                
                                if days <= 60:  # 2 months
                                    is_active = True
                                    break
                        
                        if not is_active:
                            continue
                    
                    # Apply main filter
                    if show_only_mains and not member.get('is_main', False):
                        continue
                        
                    filtered_members.append(member)
                
                # If we have a filtered list, recalculate class distribution
                if filtered_members:
                    filtered_roster = {'members': filtered_members}
                    class_counts = get_character_class_summary(filtered_roster)
                    class_counts_df = pd.DataFrame(list(class_counts.items()), columns=['Class', 'Count'])
        else:
            st.error("Invalid roster data format. Cannot calculate class distribution.")
            st.stop()
    
    # Check if we have data after filtering
    if len(class_counts_df) == 0:
        st.warning("No characters match the selected filters. Try relaxing your filter criteria.")
        st.stop()
    
    # Class colors (approximate WoW class colors)
    class_colors = {
        'Death Knight': '#C41E3A',
        'Demon Hunter': '#A330C9',
        'Druid': '#FF7C0A',
        'Evoker': '#33937F',
        'Hunter': '#AAD372',
        'Mage': '#3FC7EB',
        'Monk': '#00FF98',
        'Paladin': '#F48CBA',
        'Priest': '#FFFFFF',
        'Rogue': '#FFF468',
        'Shaman': '#0070DD',
        'Warlock': '#8788EE',
        'Warrior': '#C69B6D',
        'Unknown': '#808080'
    }
    
    # Sort class counts for better visualization
    class_counts_df = class_counts_df.sort_values(by='Count', ascending=False)
    
    # Create color list
    colors = [class_colors.get(cls, '#808080') for cls in class_counts_df['Class']]
    
    col1, col2 = st.columns(2)
    
    with col1:
        # ECharts class distribution visualization
        def create_class_distribution_chart(class_counts_df, class_colors_map):
            # Prepare data in the format ECharts expects
            classes = class_counts_df['Class'].tolist()
            counts = class_counts_df['Count'].tolist()
            
            # Create color list in the same order as classes
            colors = [class_colors_map.get(cls, '#808080') for cls in classes]
            
            # ECharts options
            options = {
                "tooltip": {"trigger": "item", "formatter": "{a} <br/>{b}: {c} ({d}%)"},
                "legend": {
                    "orient": "vertical",
                    "right": 10,
                    "data": classes,
                    "textStyle": {"color": "#333"}
                },
                "series": [
                    {
                        "name": "Class Distribution",
                        "type": "pie",
                        "radius": ["40%", "70%"],  # Donut chart
                        "avoidLabelOverlap": True,
                        "itemStyle": {
                            "borderRadius": 10,
                            "borderColor": "#fff",
                            "borderWidth": 2
                        },
                        "label": {
                            "show": True,
                            "formatter": "{b}: {c} ({d}%)"
                        },
                        "emphasis": {
                            "itemStyle": {
                                "shadowBlur": 10,
                                "shadowOffsetX": 0,
                                "shadowColor": "rgba(0, 0, 0, 0.5)"
                            },
                            "label": {
                                "show": True,
                                "fontSize": 16,
                                "fontWeight": "bold"
                            }
                        },
                        "data": [
                            {"value": counts[i], "name": classes[i], "itemStyle": {"color": colors[i]}}
                            for i in range(len(classes))
                        ],
                    }
                ],
                "backgroundColor": "rgba(255, 255, 255, 0.0)",  # Transparent background
            }
            
            return options
        
        # Create and display the chart with ECharts
        echarts_options = create_class_distribution_chart(class_counts_df, class_colors)
        st_echarts(options=echarts_options, height="400px")
    
    with col2:
        # Define role mapping
        role_mapping = {
            'Death Knight': 'Tank/DPS',
            'Demon Hunter': 'Tank/DPS',
            'Druid': 'Tank/Healer/DPS',
            'Evoker': 'Healer/DPS',
            'Hunter': 'DPS',
            'Mage': 'DPS',
            'Monk': 'Tank/Healer/DPS',
            'Paladin': 'Tank/Healer/DPS',
            'Priest': 'Healer/DPS',
            'Rogue': 'DPS',
            'Shaman': 'Healer/DPS',
            'Warlock': 'DPS',
            'Warrior': 'Tank/DPS',
            'Unknown': 'Unknown'
        }
        
        # Calculate potential roles based on class distribution
        tanks = sum(class_counts_df[class_counts_df['Class'].map(lambda x: 'Tank' in role_mapping.get(x, ''))]['Count'])
        healers = sum(class_counts_df[class_counts_df['Class'].map(lambda x: 'Healer' in role_mapping.get(x, ''))]['Count'])
        dps = sum(class_counts_df[class_counts_df['Class'].map(lambda x: 'DPS' in role_mapping.get(x, ''))]['Count'])
        
        # Create role distribution data
        role_data = pd.DataFrame({
            'Role': ['Tank', 'Healer', 'DPS'],
            'Count': [tanks, healers, dps]
        })
        
        # Role colors
        role_colors = {
            'Tank': '#A52A2A',  # Brown for tanks
            'Healer': '#2E8B57', # Green for healers
            'DPS': '#1E90FF'     # Blue for DPS
        }
        
        # ECharts options for role distribution
        def create_role_distribution_chart(role_data_df, role_colors_map):
            roles = role_data_df['Role'].tolist()
            counts = role_data_df['Count'].tolist()
            colors = [role_colors_map.get(role, '#808080') for role in roles]
            
            options = {
                "tooltip": {"trigger": "axis"},
                "legend": {"data": roles, "textStyle": {"color": "#333"}},
                "xAxis": {
                    "type": "category", 
                    "data": roles,
                    "axisLabel": {"color": "#333"}
                },
                "yAxis": {"type": "value", "axisLabel": {"color": "#333"}},
                "series": [
                    {
                        "name": "Role Count",
                        "type": "bar",
                        "data": [
                            {"value": counts[i], "itemStyle": {"color": colors[i]}}
                            for i in range(len(counts))
                        ],
                        "label": {"show": True, "position": "top"},
                        "barWidth": "60%",
                        "emphasis": {
                            "itemStyle": {
                                "shadowBlur": 10,
                                "shadowOffsetX": 0,
                                "shadowColor": "rgba(0, 0, 0, 0.5)"
                            }
                        }
                    }
                ],
                "backgroundColor": "rgba(255, 255, 255, 0.0)",  # Transparent background
            }
            
            return options
        
        # Create and display the chart with ECharts
        role_chart_options = create_role_distribution_chart(role_data, role_colors)
        st_echarts(options=role_chart_options, height="400px")
    
    # Display table
    st.dataframe(class_counts_df, use_container_width=True)
    
    # Show count of characters considered
    st.info(f"Analysis based on {len(class_counts_df)} characters matching the selected filters")

# Tab 4: Activity Metrics
with tab4:
    st.header("Activity Metrics")
    
    # Process active members data
    active_df = pd.DataFrame(active_members)
    
    if not active_df.empty:
        # Convert days since login to activity level
        def activity_level(days):
            if days <= 7:
                return "Very Active (< 1 week)"
            elif days <= 14:
                return "Active (< 2 weeks)"
            elif days <= 21:
                return "Somewhat Active (< 3 weeks)"
            else:
                return "Less Active (< 1 month)"
        
        active_df['Activity Level'] = active_df['days_since_login'].apply(activity_level)
        
        # Activity breakdown
        activity_counts = active_df['Activity Level'].value_counts().reset_index()
        activity_counts.columns = ['Activity Level', 'Count']
        
        # Define sort order
        sort_order = ["Very Active (< 1 week)", "Active (< 2 weeks)", 
                      "Somewhat Active (< 3 weeks)", "Less Active (< 1 month)"]
        
        # Sort by custom order
        activity_counts['sort'] = activity_counts['Activity Level'].map({level: i for i, level in enumerate(sort_order)})
        activity_counts = activity_counts.sort_values('sort').drop('sort', axis=1)
        
        # Create bar chart
        fig = px.bar(activity_counts, x='Activity Level', y='Count', 
                     title='Member Activity Levels',
                     color='Activity Level',
                     color_discrete_map={
                         "Very Active (< 1 week)": "#4CAF50",
                         "Active (< 2 weeks)": "#8BC34A",
                         "Somewhat Active (< 3 weeks)": "#FFC107",
                         "Less Active (< 1 month)": "#FF9800"
                     })
        
        # Update layout
        fig.update_layout(xaxis_title="Activity Level", yaxis_title="Number of Members")
        
        # Display chart
        st.plotly_chart(fig, use_container_width=True)
        
        # Display active members
        st.subheader("Active Members List")
        
        # Add filters
        col1, col2, col3 = st.columns(3)
        with col1:
            activity_filter = st.multiselect("Filter by Activity Level", 
                                          options=sort_order,
                                          default=[])
        
        with col2:
            class_filter_active = st.multiselect("Filter by Class", 
                                              options=sorted(active_df['class'].unique()),
                                              default=[])
                                              
        with col3:
            realm_filter_active = st.multiselect("Filter by Realm",
                                             options=sorted(active_df['realm'].unique() if 'realm' in active_df.columns else []),
                                             default=[])
        
        # Apply filters
        filtered_active_df = active_df
        if activity_filter:
            filtered_active_df = filtered_active_df[filtered_active_df['Activity Level'].isin(activity_filter)]
        
        if class_filter_active:
            filtered_active_df = filtered_active_df[filtered_active_df['class'].isin(class_filter_active)]
            
        if 'realm' in filtered_active_df.columns and realm_filter_active:
            filtered_active_df = filtered_active_df[filtered_active_df['realm'].isin(realm_filter_active)]
        
        # Sort by last login
        filtered_active_df = filtered_active_df.sort_values('days_since_login')
        
        # Display table
        columns_to_display = ['name', 'class', 'level']
        if 'realm' in filtered_active_df.columns:
            columns_to_display.append('realm')
        columns_to_display.extend(['last_login', 'days_since_login', 'Activity Level'])
        
        st.dataframe(filtered_active_df[columns_to_display], 
                     use_container_width=True)
    else:
        st.warning("No active member data available. Try refreshing the data.")

# Footer
st.markdown("---")
st.markdown("*Where We Wipe on Trash But Still Somehow Kill Bosses*")
st.markdown(f"Data powered by Blizzard API • Last updated: {report['report_generated']}")
