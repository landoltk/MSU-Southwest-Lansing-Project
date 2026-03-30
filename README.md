# MSU-Southwest-Lansing-Project
CMSE495 Spring 2026 Capstone
Group Members: Mason Lee, Kyle Landolt, Vibu Darshan, Will McNeilly
<br>
<br>
This course is a semester long project where you collaborate with an organization. Our community partner is the CCED (Center for Community and Economic Development) and our purpose is to build an open-source tool that can present community data about Southwest Lansing in a user-friendly and understandable way. Our goal is to demonstrate this tool in a way that is comprehensible for non-data scientists. We are exhilarated to be working with the CCED and can't wait for the tool that we will produce.
<br>
<br>
MVP Video Link
<br>
<br>
https://michiganstate.sharepoint.com/:v:/s/Section_SS26-CMSE-495-001-226213802-EL-32-A26-MSU-SW_Lansing/IQAHOiGqXb7DTLhUoLPM53q5ASNbF7zFKoUlcDQwD6v0tZI?e=KzlmKz&nav=eyJyZWZlcnJhbEluZm8iOnsicmVmZXJyYWxBcHAiOiJTdHJlYW1XZWJBcHAiLCJyZWZlcnJhbFZpZXciOiJTaGFyZURpYWxvZy1MaW5rIiwicmVmZXJyYWxBcHBQbGF0Zm9ybSI6IldlYiIsInJlZmVycmFsTW9kZSI6InZpZXcifX0%3D
<br>
# Folder Location and Repository Rules:

Our data is located inside the "app" folder and you will find an excel sheet with all of our data organized and documented. Any data that is used to add future layers needs to be recorded and filed into the same organization outlined in the document.
<br>
**Repository Rules:**
1. Work in a local branch and commit changes with clear descriptions of changes. List filename and then the changes made so we can keep track of everything
2. Any data added needs to be documented inside the "app" folder and then in the excel sheet marked "data"
3. Mark any layer additions below with extra added data in the "Layers" section

<br>

# Boundary Location:
<br>

Western Boundary - South Waverly Road
<br>

Eastern Boundary - Martin Luther King BLVD, connects to South Washington RD through Jolly Rd, then goes all the way down to Edgewood BLVD.
<br>

Northern Boundary - West Mt Hope Avenue
<br>

Southern Boundary - I-96 boundary
<br>

# Layers Completed:

When the app is complete I will add all of our layers here so that viewers can have a good understanding of what the tool represents before going on
<br>

# Code Requirements and Installation Instructions Link
**Required Packages:**
<br>
fastapi==0.129.0
<br>
uvicorn==0.41.0
<br>
pathlib==1.0.1
<br>
**Official App Link:**
<br>https://msu-southwest-lansing-project.onrender.com/
<br>
**App Installation Instructions Shareable Link:**

[INSTALL.md](./INSTALL.md)
<br>

# App Reproducibility

**Initial app overview:**
When you open the app, you will be met with an overview of Lansing that is covered in green block groups. When the app loads, the Southwest Lansing block groups will be highlighted in blue, which means that they are selected. You can press the "Southwest Lansing" button in the "Choose your data display method:" area and that will re-select all 22 of Southwest Lansing's groups.

**Current Working Filters:**

**1. Filters:**

Working!
- Food: Displays community gardens in the immediate area
- Population: Population data is connected and shown through submission
  
Waiting to implement
- Health
- Income
- Race
- Household descriptions

**2. Data Viewing Methods:**

Working!
- Southwest Lansing: Clicking this immediately highlights all of Southwest Lansing's block groups
  
Waiting to implement:
- Zip code data
- Radius (Drawing a circle and having the block groups inside of the circle being selected)
- Neighborhood data
  
# Layer 1: Block Groups

**Block Group Color Meaning:**

- **Green**: Not selected, will not be included in data  
- **Blue**: Fully selected, will always be included in data  
- **Bright Yellow**: Deselected, removed from selection and excluded from data  
- **Dim Yellow**: Selected and highlighted in presented data
  
**Drawer Descriptions:**
- **Filters:**
A pretty simple, yet vitally important drawer to the project. To be mentioned below, no data can be shown without a filter present. The data is in checkbox form, but only one can be selected at a time. When this one is selected, you can check the main bar to see "Selected filter: blank" so that you don't have to open the filters tab to always see your active filter.

- **About the Team:**
This is where we present our Thanks to the Community for Center and Economic Development. It is a great tab to give credit to those who made the project possible: the Southwest Lansing team and the CCED. Roles, Majors, and Contact Information of the team members can be found here

**How to view the data:**
<<<<<<< HEAD
<br>
As mentioned in the overview, the 22 block groups representing Southwest Lansing start selected. However, you will notice that the "Show data" tab is still grayed out on the right-hand side. In order to view the data, you must have a selected block group and a filter. You must open the "Filters" drawer attached to the sidebar and pick a filter of your choice. When the filter is selected, the Show data tab will turn blue indicating that you can now view data.
<br>
After "Show data" was selected, the table of data will display beneath the button. There will be an "X" in the top right that you can click at any time to remove the data table. The old table will be displayed until the X is clicked or a new set of data is being submitted.

**Data Cleanup and Other Useful Tools**
- **Unselect All:** This button will remove all of the currently selected groups. If you are ever overwhelmed or can't get rid of block groups easily, click this button and they will all deselect.
<br>
- **Block Group Hyperlinks:** These links when clicked will highlight that block group on the graph. The selected block groups only appear in this list, so each hyperlink corresponds to a blue selected block group. The color of the block is Dim Yellow, and this does not select or deselect anything, the block group will appear in the data.
<br>
- **Zoom Features:** Above the "About the Team" bar, there is a bar with a "+", a "-", and a compass marker. The plus sign will zoom you in, while the minus sign will zoom you out. The compass marker, is supposed to be clicked and held as it rotates the map. The user can click and hold to rotate the map freely.
=======
As mentioned in the overview, the 22 block groups representing Southwest Lansing start selected. However, you will notice that the "Show data" tab is still grayed out on the right-hand side. In order to view the data, you must have a selected block group and click the "Submit Selection" button. This activates the filters in the "Filters" drawer which can then be selected which activates the "Show data" button. Once the filter of your choice is selected, the "Show data" button can be clicked which will display any relevant data available.

After "Show data" was selected, the table of data will display beneath the button. There will be an "X" in the top right that you can click at any time to remove the data table. The old table will be displayed until the X is clicked or a new set of data is being submitted.

**Data Cleanup and Other Useful Tools**
Unselect All: This button will remove all of the currently selected groups. If you are ever overwhelmed or can't get rid of block groups easily, click this button and they will all deselect. This button is replaced with an "Edit Selection" button once selection has been submitted which will revert the app to selection mode.

Block Group Hyperlinks: These links when clicked will highlight that block group on the graph. The selected block groups only appear in this list, so each hyperlink corresponds to a blue selected block group. The color of the block is Dim Yellow, and this does not select or deselect anything, the block group will appear in the data.

Zoom Features: Above the "About the Team" bar, there is a bar with a "+", a "-", and a compass marker. The plus sign will zoom you in, while the minus sign will zoom you out. The compass marker, is supposed to be clicked and held as it rotates the map. The user can click and hold to rotate the map freely.
>>>>>>> e92e125997217a845c3cd7b4e80aa0b1aa78dc4e


# Contact the Creators
**2026 Spring Southwest Lansing Team:**
<br>
Kyle Landolt - landoltk@msu.edu
<br>
Mason Lee - leemason@msu.edu
<br>
William McNeilly - mcneil42@msu.edu
<br>
Vibu Darshan - darshanv@msu.edu
<br>
Email any of us if there are questions!

