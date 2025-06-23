import json
from datetime import datetime, timedelta
import pytz
from dateutil import parser

def parse_swift_treatments(data):
    """Parse Swift treatment data, focusing on temp bolus entries."""
    temp_boluses = []
    
    for entry in data:
        # Look for entries with isTempBolus = true
        if 'isTempBolus' in entry and entry['isTempBolus'] == True and '_type' in entry and entry['_type'] == 'Bolus':
            temp_bolus = {
                'date': entry.get('date'),
                'timestamp': entry.get('timestamp'),
                'started_at': entry.get('started_at'),
                'insulin': entry.get('insulin'),
                'id': entry.get('id'),
                'source': 'swift'
            }
            temp_boluses.append(temp_bolus)
    
    return temp_boluses

def parse_js_treatments(data):
    """Parse JS treatment data, focusing on temp bolus entries."""
    temp_boluses = []
    
    for entry in data:
        # Look for entries with created_at field that are likely temp boluses
        if 'created_at' in entry and 'insulin' in entry:
            # Generate an ID based on timestamp if not present
            entry_id = str(entry.get('date'))
            
            temp_bolus = {
                'date': entry.get('date'),
                'timestamp': entry.get('created_at'),
                'started_at': entry.get('created_at'),
                'insulin': entry.get('insulin'),
                'id': entry_id,
                'source': 'js'
            }
            temp_boluses.append(temp_bolus)
    
    return temp_boluses

def match_entries(swift_entries, js_entries, tolerance_ms=1000):
    """Match entries between Swift and JS based on timestamp/date."""
    matched_entries = []
    unmatched_swift = []
    unmatched_js = []
    
    # Create a copy of js_entries to track which ones we've matched
    remaining_js = js_entries.copy()
    
    for swift_entry in swift_entries:
        found_match = False
        swift_date = swift_entry['date']
        
        # Try to find the closest match within tolerance
        closest_js_entry = None
        closest_diff = float('inf')
        closest_idx = -1
        
        for i, js_entry in enumerate(remaining_js):
            js_date = js_entry['date']
            current_diff = abs(swift_date - js_date)
            
            # If dates are within tolerance and this is the closest match so far
            if current_diff <= tolerance_ms and current_diff < closest_diff:
                closest_js_entry = js_entry
                closest_diff = current_diff
                closest_idx = i
        
        if closest_js_entry is not None:
            matched_entries.append({
                'swift': swift_entry,
                'js': closest_js_entry,
                'time_diff_ms': closest_diff
            })
            # Remove the matched JS entry
            remaining_js.pop(closest_idx)
            found_match = True
        
        if not found_match:
            unmatched_swift.append(swift_entry)
    
    # Any remaining JS entries were not matched
    unmatched_js = remaining_js
    
    return matched_entries, unmatched_swift, unmatched_js

def print_summary(matched, unmatched_swift, unmatched_js, swift_entries, js_entries):
    """Print a summary of the comparison results."""
    print(f"Total Swift temp bolus entries: {len(swift_entries)}")
    print(f"Total JS temp bolus entries: {len(js_entries)}")
    print(f"Total matched entries: {len(matched)}")
    print(f"Unmatched Swift entries: {len(unmatched_swift)}")
    print(f"Unmatched JS entries: {len(unmatched_js)}")
    
    # Check for insulin value differences in matched entries
    insulin_diff_count = 0
    pos_diff_count = 0
    neg_diff_count = 0
    zero_diff_count = 0
    
    for entry in matched:
        swift_insulin = entry['swift']['insulin']
        js_insulin = entry['js']['insulin']
        diff = swift_insulin - js_insulin
        
        if diff != 0:
            insulin_diff_count += 1
            if diff > 0:
                pos_diff_count += 1
            else:
                neg_diff_count += 1
        else:
            zero_diff_count += 1
    
    print(f"Matched entries with different insulin values: {insulin_diff_count}")
    print(f"  - Swift > JS: {pos_diff_count}")
    print(f"  - Swift < JS: {neg_diff_count}")
    print(f"  - Swift = JS: {zero_diff_count}")
    
    # Calculate percentage match
    if len(swift_entries) > 0 and len(js_entries) > 0:
        pct_matched_swift = (len(matched) / len(swift_entries)) * 100
        pct_matched_js = (len(matched) / len(js_entries)) * 100
        print(f"Percentage of Swift entries matched: {pct_matched_swift:.2f}%")
        print(f"Percentage of JS entries matched: {pct_matched_js:.2f}%")
    
    # Count insulin value patterns
    swift_insulin_counts = {}
    js_insulin_counts = {}
    
    for entry in swift_entries:
        insulin = entry['insulin']
        swift_insulin_counts[insulin] = swift_insulin_counts.get(insulin, 0) + 1
    
    for entry in js_entries:
        insulin = entry['insulin']
        js_insulin_counts[insulin] = js_insulin_counts.get(insulin, 0) + 1
        
    print("\nInsulin value distribution in Swift:")
    for insulin, count in sorted(swift_insulin_counts.items()):
        print(f"  {insulin}: {count} entries")
    
    print("\nInsulin value distribution in JS:")
    for insulin, count in sorted(js_insulin_counts.items()):
        print(f"  {insulin}: {count} entries")

        
def main():
    # Load the data files
    with open('swift_treatments.json', 'r') as f:
        swift_data = json.load(f)
    
    with open('js_treatments.json', 'r') as f:
        js_data = json.load(f)
    
    # Parse the data
    swift_temp_boluses = parse_swift_treatments(swift_data)
    js_temp_boluses = parse_js_treatments(js_data)
    
    print(f"Swift temp boluses: {len(swift_temp_boluses)}")
    print(f"JS temp boluses: {len(js_temp_boluses)}")
    
    # Match entries between the two sources (using a larger tolerance of 5 seconds)
    matched, unmatched_swift, unmatched_js = match_entries(swift_temp_boluses, js_temp_boluses, tolerance_ms=5000)
    
    # Print summary
    print_summary(matched, unmatched_swift, unmatched_js, swift_temp_boluses, js_temp_boluses)

    print("Unmatched swift")
    print(json.dumps(unmatched_swift, indent=4, sort_keys=True))

    print("Unmatched js")
    print(json.dumps(unmatched_js, indent=4, sort_keys=True))

    dia_ago = parser.isoparse("2025-02-25T01:48:26.307Z") + timedelta(hours=-10) + timedelta(minutes=-1)
    
    swift_netbasalinsulin = 0.
    swift_bolusinsulin = 0.
    for entry in swift_data:
        entry_time = parser.isoparse(entry['timestamp'])
        if entry_time <= dia_ago:
            continue
        
        insulin = entry.get('insulin')
        if not insulin:
            continue
        
        if insulin < 0.1:
            swift_netbasalinsulin += insulin
        else:
            swift_bolusinsulin += insulin

    js_netbasalinsulin = 0.
    js_bolusinsulin = 0.
    for entry in js_data:
        insulin = entry.get('insulin')
        if not insulin:
            continue

        ts = entry.get('created_at')
        if not ts:
            ts = entry.get('started_at')
        entry_time = parser.isoparse(ts)
        if entry_time <= dia_ago:
            continue

        if insulin < 0.1:
            js_netbasalinsulin += insulin
        else:
            js_bolusinsulin += insulin
    print(f'Swift net {swift_netbasalinsulin} bolus {swift_bolusinsulin}')
    print(f'Javas net {js_netbasalinsulin} bolus {js_bolusinsulin}')
    
if __name__ == "__main__":
    main()
