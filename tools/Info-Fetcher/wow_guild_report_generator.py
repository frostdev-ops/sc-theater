import pandas as pd
import json
import os
from datetime import datetime
import xlsxwriter


class GuildReportGenerator:
    def __init__(self, guild_data_path='guild_data', filter_options=None):
        self.guild_data_path = guild_data_path
        self.report_path = os.path.join(guild_data_path, 'reports')
        os.makedirs(self.report_path, exist_ok=True)
        
        # Default filter options
        self.filter_options = filter_options or {}
        
        # Load data
        self.report = self._load_json(os.path.join(guild_data_path, 'shadow_company_report.json'))
        self.roster = self._load_json(os.path.join(guild_data_path, 'roster.json'))
        self.achievements = self._load_json(os.path.join(guild_data_path, 'achievements.json'))
        self.raid_progress = self._load_json(os.path.join(guild_data_path, 'raid_progress.json'))
        self.active_members = self._load_json(os.path.join(guild_data_path, 'active_members.json'))
        
        # Set max level from report or default to 80
        self.max_level = self.report.get('max_level', 80)
    
    def _load_json(self, file_path):
        """Load JSON data from file"""
        try:
            with open(file_path, 'r') as f:
                return json.load(f)
        except:
            print(f"Warning: Could not load {file_path}")
            return {}
    
    def _generate_raid_progress_html(self):
        """Generate HTML for raid progress section"""
        html = ""
        
        if not self.raid_progress:
            return "<p>No raid progress data available.</p>"
        
        for category, achievements in self.raid_progress.items():
            completed = sum(1 for a in achievements if a['completed'])
            total = len(achievements)
            percent = int((completed / total) * 100) if total > 0 else 0
            
            html += f"""
            <h3>{category}</h3>
            <div class="progress-bar">
                <div class="progress" style="width: {percent}%">{completed}/{total} ({percent}%)</div>
            </div>
            <table>
                <tr>
                    <th>Achievement</th>
                    <th>Description</th>
                    <th>Status</th>
                    <th>Completion Date</th>
                </tr>
            """
            
            for achievement in achievements:
                status = "✅ Completed" if achievement['completed'] else "❌ Incomplete"
                completion_date = achievement['completed_date'] if achievement['completed'] else "N/A"
                
                html += f"""
                <tr>
                    <td>{achievement['name']}</td>
                    <td>{achievement['description']}</td>
                    <td>{status}</td>
                    <td>{completion_date}</td>
                </tr>
                """
            
            html += "</table>"
        
        return html
    
    def _generate_class_distribution_html(self):
        """Generate HTML for class distribution section"""
        if not self.roster or 'members' not in self.roster:
            return "<p>No roster data available.</p>"
        
        # Process roster for class distribution
        class_counts = {}
        for member in self.roster['members']:
            try:
                character = member['character']
                class_name = character.get('playable_class', {}).get('name', 'Unknown')
                
                if class_name in class_counts:
                    class_counts[class_name] += 1
                else:
                    class_counts[class_name] = 1
            except:
                continue
        
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
        
        # Generate table
        html = """
        <table>
            <tr>
                <th>Class</th>
                <th>Count</th>
                <th>Percentage</th>
                <th>Distribution</th>
            </tr>
        """
        
        total = sum(class_counts.values())
        
        for class_name, count in sorted(class_counts.items(), key=lambda x: x[1], reverse=True):
            percent = (count / total) * 100 if total > 0 else 0
            color = class_colors.get(class_name, '#808080')
            
            html += f"""
            <tr>
                <td>{class_name}</td>
                <td>{count}</td>
                <td>{percent:.1f}%</td>
                <td>
                    <div class="progress-bar">
                        <div class="progress" style="width: {percent}%; background-color: {color}"></div>
                    </div>
                </td>
            </tr>
            """
        
        html += "</table>"
        return html
    
    def _generate_roster_table_html(self):
        """Generate HTML table for guild roster"""
        if not self.roster or 'members' not in self.roster:
            return "<p>No roster data available.</p>"
        
        # Define rank names
        rank_names = {
            0: "Preceptor",
            1: "Justicar",
            2: "Adjutant", 
            3: "Sentinel",
            4: "Aspirant"
        }
        
        # Apply filters to members
        filtered_members = self._apply_filters(self.roster.get('members', []))
        
        # Process roster for table
        html = """
        <table>
            <tr>
                <th>Name</th>
                <th>Level</th>
                <th>Class</th>
                <th>Realm</th>
                <th>Rank</th>
                <th>Character Type</th>
            </tr>
        """
        
        # Sort by rank and then name
        sorted_members = sorted(
            filtered_members, 
            key=lambda x: (
                x.get('rank', 999), 
                x.get('character', {}).get('name', 'Zzz').lower()
            )
        )
        
        for member in sorted_members:
            try:
                character = member['character']
                name = character.get('name', 'Unknown')
                level = character.get('level', 0)
                
                # Handle class information that might be in different formats
                class_name = "Unknown"
                if 'playable_class' in character:
                    if isinstance(character['playable_class'], dict):
                        if 'name' in character['playable_class']:
                            class_name = character['playable_class']['name']
                        elif 'id' in character['playable_class']:
                            # Map class ID to name if needed
                            class_mapping = {
                                1: "Warrior", 2: "Paladin", 3: "Hunter", 4: "Rogue", 
                                5: "Priest", 6: "Death Knight", 7: "Shaman", 8: "Mage",
                                9: "Warlock", 10: "Monk", 11: "Druid", 
                                12: "Demon Hunter", 13: "Evoker"
                            }
                            class_id = character['playable_class']['id']
                            class_name = class_mapping.get(class_id, "Unknown")
                
                realm = character.get('realm', {}).get('name', self.report.get('realm', 'Unknown'))
                if isinstance(realm, dict) and 'name' in realm:
                    realm = realm['name']
                
                rank = member.get('rank', 0)
                rank_name = rank_names.get(rank, f"Rank {rank}")
                
                # Determine if character is main or alt
                character_type = "Unknown"
                if member.get('is_main', False):
                    character_type = "Main"
                elif member.get('is_alt', False):
                    character_type = "Alt"
                
                html += f"""
                <tr>
                    <td>{name}</td>
                    <td>{level}</td>
                    <td>{class_name}</td>
                    <td>{realm}</td>
                    <td>{rank_name}</td>
                    <td>{character_type}</td>
                </tr>
                """
            except:
                continue
        
        html += "</table>"
        return html
    
    def _apply_filters(self, members):
        """Apply filters to the member list based on filter options"""
        if not members:
            return []
            
        filtered_members = []
        
        for member in members:
            try:
                character = member.get('character', {})
                
                # Skip if no character data
                if not character:
                    continue
                
                # Filter by max level
                if self.filter_options.get('max_level_only') and character.get('level', 0) < self.max_level:
                    continue
                
                # Filter by activity
                if self.filter_options.get('active_only'):
                    # Find character in active_members list
                    char_name = character.get('name', '')
                    active_char = next((a for a in self.active_members if a.get('name') == char_name), None)
                    
                    if not active_char or active_char.get('days_since_login', 999) > self.filter_options.get('days_threshold', 60):
                        continue
                
                # Filter by class
                if self.filter_options.get('classes'):
                    class_name = character.get('playable_class', {}).get('name', 'Unknown')
                    if class_name not in self.filter_options['classes']:
                        continue
                
                # Filter by main/alt status
                if self.filter_options.get('main_only') and not member.get('is_main', False):
                    continue
                
                # Filter by rank
                if self.filter_options.get('ranks'):
                    rank = str(member.get('rank', ''))
                    if rank not in self.filter_options['ranks']:
                        continue
                
                # If all filters pass, include this member
                filtered_members.append(member)
                
            except Exception as e:
                print(f"Error filtering member: {e}")
                continue
                
        return filtered_members
    
    def _generate_active_members_html(self):
        """Generate HTML for active members section"""
        if not self.active_members:
            return "<p>No active member data available.</p>"
        
        # Process active members for activity levels
        activity_levels = {
            "Very Active (< 1 week)": 0,
            "Active (< 2 weeks)": 0,
            "Somewhat Active (< 3 weeks)": 0,
            "Less Active (< 1 month)": 0
        }
        
        for member in self.active_members:
            days = member.get('days_since_login', 30)
            
            if days <= 7:
                activity_levels["Very Active (< 1 week)"] += 1
            elif days <= 14:
                activity_levels["Active (< 2 weeks)"] += 1
            elif days <= 21:
                activity_levels["Somewhat Active (< 3 weeks)"] += 1
            else:
                activity_levels["Less Active (< 1 month)"] += 1
        
        # Generate activity summary
        html = """
        <h3>Activity Summary</h3>
        <div class="metric-container">
        """
        
        colors = {
            "Very Active (< 1 week)": "#4CAF50",
            "Active (< 2 weeks)": "#8BC34A", 
            "Somewhat Active (< 3 weeks)": "#FFC107",
            "Less Active (< 1 month)": "#FF9800"
        }
        
        for level, count in activity_levels.items():
            color = colors.get(level, "#808080")
            html += f"""
            <div class="metric-box" style="border-left: 5px solid {color}">
                <div class="metric-value">{count}</div>
                <div class="metric-label">{level}</div>
            </div>
            """
        
        html += """
        </div>
        
        <h3>Active Members List</h3>
        <table>
            <tr>
                <th>Name</th>
                <th>Class</th>
                <th>Level</th>
                <th>Realm</th>
                <th>Last Login</th>
                <th>Days Since Login</th>
                <th>Activity Level</th>
            </tr>
        """
        
        # Sort by days since login
        sorted_members = sorted(self.active_members, key=lambda x: x.get('days_since_login', 999))
        
        for member in sorted_members:
            name = member.get('name', 'Unknown')
            class_name = member.get('class', 'Unknown')
            level = member.get('level', 0)
            realm = member.get('realm', self.report.get('realm', 'Unknown'))
            last_login = member.get('last_login', 'Unknown')
            days = member.get('days_since_login', 0)
            
            if days <= 7:
                activity = "Very Active (< 1 week)"
                color = colors["Very Active (< 1 week)"]
            elif days <= 14:
                activity = "Active (< 2 weeks)"
                color = colors["Active (< 2 weeks)"]
            elif days <= 21:
                activity = "Somewhat Active (< 3 weeks)"
                color = colors["Somewhat Active (< 3 weeks)"]
            else:
                activity = "Less Active (< 1 month)"
                color = colors["Less Active (< 1 month)"]
            
            html += f"""
            <tr>
                <td>{name}</td>
                <td>{class_name}</td>
                <td>{level}</td>
                <td>{realm}</td>
                <td>{last_login}</td>
                <td>{days}</td>
                <td style="color: {color}; font-weight: bold;">{activity}</td>
            </tr>
            """
        
        html += "</table>"
        return html
    
    def generate_html_report(self):
        """Generate an HTML report with all guild information"""
        if not self.report:
            print("No guild data available. Report cannot be generated.")
            return None
        template = f"""
        <!DOCTYPE html>
        <html lang="en">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>Shadow Company Guild Report</title>
            <style>
                body {{
                    font-family: Arial, sans-serif;
                    line-height: 1.6;
                    color: #333;
                    max-width: 1200px;
                    margin: 0 auto;
                    padding: 20px;
                }}
                h1, h2, h3 {{
                    color: #0b2c5f;
                }}
                table {{
                    border-collapse: collapse;
                    width: 100%;
                    margin-bottom: 20px;
                }}
                th, td {{
                    border: 1px solid #ddd;
                    padding: 8px;
                }}
                th {{
                    background-color: #0b2c5f;
                    color: white;
                    text-align: left;
                }}
                tr:nth-child(even) {{
                    background-color: #f2f2f2;
                }}
                .header {{
                    background-color: #1a1a1a;
                    color: white;
                    padding: 20px;
                    border-radius: 5px;
                    margin-bottom: 20px;
                }}
                .metric-container {{
                    display: flex;
                    flex-wrap: wrap;
                    gap: 20px;
                    margin-bottom: 20px;
                }}
                .metric-box {{
                    background-color: #f8f9fa;
                    border-radius: 5px;
                    padding: 15px;
                    flex: 1;
                    min-width: 200px;
                    box-shadow: 0 2px 4px rgba(0,0,0,0.1);
                }}
                .metric-value {{
                    font-size: 2rem;
                    font-weight: bold;
                    color: #0b2c5f;
                }}
                .metric-label {{
                    font-size: 1rem;
                    color: #666;
                }}
                .section {{
                    margin-bottom: 30px;
                }}
                .progress-bar {{
                    background-color: #e9ecef;
                    border-radius: 4px;
                    height: 20px;
                    margin-bottom: 10px;
                }}
                .progress {{
                    background-color: #0b2c5f;
                    height: 20px;
                    border-radius: 4px;
                    color: white;
                    text-align: center;
                }}
                .footer {{
                    margin-top: 40px;
                    padding-top: 20px;
                    border-top: 1px solid #ddd;
                    text-align: center;
                    font-size: 0.9rem;
                    color: #666;
                }}
            </style>
        </head>
        <body>
            <div class="header">
                <h1>🌑✨ {self.report.get('guild_name', 'Shadow Company')} ✨🌑</h1>
                <p>{self.report.get('realm', 'Area 52')} ({self.report.get('faction', 'Unknown')})</p>
            </div>
            
            <div class="metric-container">
                <div class="metric-box">
                    <div class="metric-value">{self.report.get('member_count', 0)}</div>
                    <div class="metric-label">Total Members</div>
                </div>
                
                <div class="metric-box">
                    <div class="metric-value">{len(self.active_members) if self.active_members else 0}</div>
                    <div class="metric-label">Active Members</div>
                </div>
                
                <div class="metric-box">
                    <div class="metric-value">{self.report.get('achievement_points', 0)}</div>
                    <div class="metric-label">Achievement Points</div>
                </div>
                
                <div class="metric-box">
                    <div class="metric-value">{self.report.get('created_date', 'Unknown')}</div>
                    <div class="metric-label">Guild Created</div>
                </div>
            </div>
            
            <div class="section">
                <h2>🏆 Raid Progress</h2>
                {self._generate_raid_progress_html()}
            </div>
            
            <div class="section">
                <h2>📊 Class Distribution</h2>
                {self._generate_class_distribution_html()}
            </div>
            
            <div class="section">
                <h2>👥 Guild Roster</h2>
                {self._generate_roster_table_html()}
            </div>
            
            <div class="section">
                <h2>⏱ Member Activity</h2>
                {self._generate_active_members_html()}
            </div>
            
            <div class="footer">
                <p>Generated on {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}</p>
                <p><i>Where We Wipe on Trash But Still Somehow Kill Bosses</i></p>
            </div>
        </body>
        </html>
        """
        
        # Create report filename with timestamp
        timestamp = datetime.now().strftime('%Y%m%d_%H%M%S')
        filename = os.path.join(self.report_path, f'guild_report_{timestamp}.html')
        
        # Write to file with UTF-8 encoding
        try:
            with open(filename, 'w', encoding='utf-8') as f:
                f.write(template)
            print(f"HTML report saved to {filename}")
            return filename
        except Exception as e:
            print(f"Error writing HTML report: {str(e)}")
            return None
    
    def generate_excel_report(self):
        """Generate an Excel spreadsheet with guild information"""
        # Create report filename with timestamp
        timestamp = datetime.now().strftime('%Y%m%d_%H%M%S')
        filename = os.path.join(self.report_path, f'guild_report_{timestamp}.xlsx')
        
        # Create Excel workbook
        workbook = xlsxwriter.Workbook(filename)
        
        # Formats
        header_format = workbook.add_format({
            'bold': True, 
            'bg_color': '#0b2c5f', 
            'font_color': 'white',
            'border': 1
        })
        
        bold_format = workbook.add_format({'bold': True})
        date_format = workbook.add_format({'num_format': 'yyyy-mm-dd'})
        percent_format = workbook.add_format({'num_format': '0.0%'})
        
        # Guild Overview worksheet
        overview_sheet = workbook.add_worksheet('Guild Overview')
        overview_sheet.set_column('A:A', 20)
        overview_sheet.set_column('B:B', 30)
        
        overview_sheet.write('A1', 'Guild Information', header_format)
        overview_sheet.write('B1', '', header_format)
        
        # Guild basic info
        row = 1
        overview_sheet.write(row, 0, 'Guild Name', bold_format)
        overview_sheet.write(row, 1, self.report.get('guild_name', 'Shadow Company'))
        row += 1
        
        overview_sheet.write(row, 0, 'Realm', bold_format)
        overview_sheet.write(row, 1, self.report.get('realm', 'Area 52'))
        row += 1
        
        overview_sheet.write(row, 0, 'Faction', bold_format)
        overview_sheet.write(row, 1, self.report.get('faction', 'Unknown'))
        row += 1
        
        overview_sheet.write(row, 0, 'Created Date', bold_format)
        overview_sheet.write(row, 1, self.report.get('created_date', 'Unknown'))
        row += 1
        
        overview_sheet.write(row, 0, 'Member Count', bold_format)
        overview_sheet.write(row, 1, self.report.get('member_count', 0))
        row += 1
        
        overview_sheet.write(row, 0, 'Active Members', bold_format)
        overview_sheet.write(row, 1, len(self.active_members) if self.active_members else 0)
        row += 1
        
        overview_sheet.write(row, 0, 'Achievement Points', bold_format)
        overview_sheet.write(row, 1, self.report.get('achievement_points', 0))
        row += 1
        
        overview_sheet.write(row, 0, 'Report Generated', bold_format)
        overview_sheet.write(row, 1, datetime.now().strftime('%Y-%m-%d %H:%M:%S'))
        row += 3
        
        # Class distribution
        if self.roster and 'members' in self.roster:
            overview_sheet.write(row, 0, 'Class Distribution', header_format)
            overview_sheet.write(row, 1, '', header_format)
            row += 1
            
            class_counts = {}
            for member in self.roster['members']:
                try:
                    character = member['character']
                    class_name = character.get('playable_class', {}).get('name', 'Unknown')
                    
                    if class_name in class_counts:
                        class_counts[class_name] += 1
                    else:
                        class_counts[class_name] = 1
                except:
                    continue
            
            total = sum(class_counts.values())
            
            for class_name, count in sorted(class_counts.items(), key=lambda x: x[1], reverse=True):
                percent = count / total if total > 0 else 0
                overview_sheet.write(row, 0, class_name, bold_format)
                overview_sheet.write(row, 1, f"{count} ({percent:.1%})")
                row += 1
        
        # Guild Roster worksheet
        roster_sheet = workbook.add_worksheet('Guild Roster')
        
        # Define column widths
        roster_sheet.set_column('A:A', 15)  # Name
        roster_sheet.set_column('B:B', 8)   # Level
        roster_sheet.set_column('C:C', 15)  # Class
        roster_sheet.set_column('D:D', 15)  # Realm
        roster_sheet.set_column('E:E', 15)  # Rank
        
        # Write headers
        roster_sheet.write('A1', 'Name', header_format)
        roster_sheet.write('B1', 'Level', header_format)
        roster_sheet.write('C1', 'Class', header_format)
        roster_sheet.write('D1', 'Realm', header_format)
        roster_sheet.write('E1', 'Rank', header_format)
        
        # Define rank names
        rank_names = {
            0: "Preceptor",
            1: "Justicar",
            2: "Adjutant", 
            3: "Sentinel",
            4: "Aspirant"
        }
        
        # Write roster data
        row = 1
        if self.roster and 'members' in self.roster:
            # Sort by rank and then name
            sorted_members = sorted(
                self.roster['members'], 
                key=lambda x: (
                    x.get('rank', 999), 
                    x.get('character', {}).get('name', 'Zzz').lower()
                )
            )
            
            for member in sorted_members:
                try:
                    character = member['character']
                    name = character.get('name', 'Unknown')
                    level = character.get('level', 0)
                    class_name = character.get('playable_class', {}).get('name', 'Unknown')
                    realm = character.get('realm', {}).get('name', self.report.get('realm', 'Unknown'))
                    rank = member.get('rank', 0)
                    rank_name = rank_names.get(rank, f"Rank {rank}")
                    
                    roster_sheet.write(row, 0, name)
                    roster_sheet.write(row, 1, level)
                    roster_sheet.write(row, 2, class_name)
                    roster_sheet.write(row, 3, realm)
                    roster_sheet.write(row, 4, rank_name)
                    
                    row += 1
                except:
                    continue
        
        # Active Members worksheet
        active_sheet = workbook.add_worksheet('Active Members')
        
        # Define column widths
        active_sheet.set_column('A:A', 15)  # Name
        active_sheet.set_column('B:B', 15)  # Class
        active_sheet.set_column('C:C', 8)   # Level
        active_sheet.set_column('D:D', 15)  # Realm
        active_sheet.set_column('E:E', 15)  # Last Login
        active_sheet.set_column('F:F', 10)  # Days Since Login
        active_sheet.set_column('G:G', 20)  # Activity Level
        
        # Write headers
        active_sheet.write('A1', 'Name', header_format)
        active_sheet.write('B1', 'Class', header_format)
        active_sheet.write('C1', 'Level', header_format)
        active_sheet.write('D1', 'Realm', header_format)
        active_sheet.write('E1', 'Last Login', header_format)
        active_sheet.write('F1', 'Days Since Login', header_format)
        active_sheet.write('G1', 'Activity Level', header_format)
        
        # Write active members data
        row = 1
        if self.active_members:
            # Sort by days since login
            sorted_members = sorted(self.active_members, key=lambda x: x.get('days_since_login', 999))
            
            for member in sorted_members:
                name = member.get('name', 'Unknown')
                class_name = member.get('class', 'Unknown')
                level = member.get('level', 0)
                realm = member.get('realm', self.report.get('realm', 'Unknown'))
                last_login = member.get('last_login', 'Unknown')
                days = member.get('days_since_login', 0)
                
                if days <= 7:
                    activity = "Very Active (< 1 week)"
                elif days <= 14:
                    activity = "Active (< 2 weeks)"
                elif days <= 21:
                    activity = "Somewhat Active (< 3 weeks)"
                else:
                    activity = "Less Active (< 1 month)"
                
                active_sheet.write(row, 0, name)
                active_sheet.write(row, 1, class_name)
                active_sheet.write(row, 2, level)
                active_sheet.write(row, 3, realm)
                active_sheet.write(row, 4, last_login)
                active_sheet.write(row, 5, days)
                active_sheet.write(row, 6, activity)
                
                row += 1
        
        # Raid Progress worksheet
        raid_sheet = workbook.add_worksheet('Raid Progress')
        
        # Define column widths
        raid_sheet.set_column('A:A', 20)  # Category
        raid_sheet.set_column('B:B', 30)  # Achievement
        raid_sheet.set_column('C:C', 40)  # Description
        raid_sheet.set_column('D:D', 15)  # Status
        raid_sheet.set_column('E:E', 20)  # Completion Date
        
        # Write headers
        raid_sheet.write('A1', 'Category', header_format)
        raid_sheet.write('B1', 'Achievement', header_format)
        raid_sheet.write('C1', 'Description', header_format)
        raid_sheet.write('D1', 'Status', header_format)
        raid_sheet.write('E1', 'Completion Date', header_format)
        
        # Write raid progress data
        row = 1
        if self.raid_progress:
            for category, achievements in self.raid_progress.items():
                for achievement in achievements:
                    status = "Completed" if achievement['completed'] else "Incomplete"
                    completion_date = achievement['completed_date'] if achievement['completed'] else "N/A"
                    
                    raid_sheet.write(row, 0, category)
                    raid_sheet.write(row, 1, achievement['name'])
                    raid_sheet.write(row, 2, achievement['description'])
                    raid_sheet.write(row, 3, status)
                    raid_sheet.write(row, 4, completion_date)
                    
                    row += 1
        
        # Close the workbook
        workbook.close()
        
        print(f"Excel report saved to {filename}")
        return filename
    
    def generate_all_reports(self):
        """Generate all report formats and return their filenames"""
        reports = {}
        
        try:
            html_report = self.generate_html_report()
            reports['html'] = html_report
        except Exception as e:
            print(f"Error generating HTML report: {str(e)}")
            reports['html'] = None
        
        try:
            excel_report = self.generate_excel_report()
            reports['excel'] = excel_report
        except Exception as e:
            print(f"Error generating Excel report: {str(e)}")
            reports['excel'] = None
        
        return reports


# Example usage
if __name__ == "__main__":
    generator = GuildReportGenerator()
    reports = generator.generate_all_reports()
    
    print(f"HTML Report: {reports['html']}")
    print(f"Excel Report: {reports['excel']}")