# MSU-Southwest-Lansing-Project
CMSE495 Spring 2026 Capstone
Group Members: Mason Lee, Kyle Landolt, Vibu Darshan, Will McNeilly
<br>
<br>
This course is a semester long project where you collaborate with an organization. Our community partner is the CCED (Center for Community and Economic Development) and our purpose is to build an open-source tool that can present community data about Southwest Lansing in a user-friendly and understandable way. Our goal was to demonstrate this tool in a way that is comprehensible for non-data scientists. We are exhilarated to have taken part in this project and we are super intrigued to see what future capstone teams could add.
<br>
<br>
## Final Project Video Link

[Watch the Final Project Video](https://michiganstate.sharepoint.com/:v:/r/sites/Section_SS26-CMSE-495-001-226213802-EL-32-A26-MSU-SW_Lansing/Shared%20Documents/MSU-SW_Lansing/Project_Deliverables/MSU_SWL_Final_Video.mp4?csf=1&web=1&e=qLxefA)

## Official App Link

[Open the Southwest Lansing App](https://msu-southwest-lansing-project.onrender.com/)

## Folder Location and Repository Rules

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
<br> 
**Our Boundary:**
<br>
- These boundaries form the region that contains the 22 block groups that we call Southwest Lansing. The tool is catered to this region and we have a Southwest Lansing button to reset in this region. The region is encapsulated within the four directional boundaries listed above. Data is not limited to this area, and data can be pulled from other areas in Lansing. When the tool loads, you will be centered on this region but can change the area of viewing through zoom/scroll controls. This boundary was defined by our Community Partner the CCED.

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
<br>
- To open the app, you can access it through the "Official App Link" here https://msu-southwest-lansing-project.onrender.com/. When you open the app, you will be met with an overview of Lansing that is covered in green block groups. When the app loads, the Southwest Lansing block groups will be highlighted in blue, which means that they are selected. You can press the "Southwest Lansing" button in the "Choose your data display method:" area and that will re-select all 22 of Southwest Lansing's groups.

**1. Filters:**

**Working!**
- **Food:** Displays community gardens in the immediate area  
- **Population:** Population data is connected and shown through submission  
- **Health:** Displays health clinics and other health related establishments in the selected region  
- **Income:** Displays median household income per block group  
- **Race:** Displays amount of people per race in selected block groups  
- **Household descriptions:** Displays household-related descriptions for selected block groups

**2. Data Viewing Methods:**

- **Southwest Lansing:** Clicking this immediately highlights all of Southwest Lansing's block groups
- **Radius** Select a radius in miles and then click anywhere on the map and any block group in that radius will be included
- **Neighborhood data** Southwest Lansing Neighborhoods will show up light blue. Click any of those areas and the block groups associated with that neighborhood will all be highlighted.
  
# Reproducing Layer 1: Block Groups

**Block Group Color Meaning:**

- **Green**: Not selected, will not be included in data  
- **Blue**: Fully selected, will always be included in data  
- **Yellow:** Selected and highlighted in displayed data, if it was clicked that will mean it was the most recent deselection
  
# Reproducing Layer 2: Block Levels

**Block Level Color Meaning:**
- **Dark Orange:** Upon submission, users are able to refine their selected area to a finer block level. Dark orange represents the currently selected block levels.
- **Light Orange:** When block levels are deselected, they turn light orange, indicating they can still be re-added later.
- **Light Green:** After modifying block levels and submitting again, the selection becomes locked. At this point, selected block levels turn light green and all deselected ones are removed.


# Reproducing The App: How to view the data:

As mentioned in the overview, the 22 block groups representing Southwest Lansing start selected. However, you will notice that the "Show data" tab is still grayed out on the right-hand side. In order to view the data, you must have a selected block group and click the "Submit Selection" button. This will bring you down to our second stage in Layer 2 of the Block Levels. When you have made your modifications there, click submit selection one more time.

After the second "Submit selection" was selected, the block levels will turn green and the "Show data" button will highlight blue. Open the filters drawer and select your filter of choice, then click "Show Data". After clicking this, a data table will drop below There will be an "X" in the top right that you can click at any time to remove the data table. The old table will be displayed until the X is clicked or a new set of data is being submitted.

**Data Cleanup and Other Useful Tools**
- **Unselect All:**
This button will remove all of the currently selected groups. If you are ever overwhelmed or can't get rid of block groups easily, click this button and they will all deselect. This button is replaced with an "Edit Selection" button once selection has been submitted which will revert the app to selection mode.

- **Zoom Features:**
Above the "About the Team" bar, there is a bar with a "+", a "-", and a compass marker. The plus sign will zoom you in, while the minus sign will zoom you out. The compass marker, is supposed to be clicked and held as it rotates the map. The user can click and hold to rotate the map freely.


- **Reset to Last Selection**  
Reset to last selection works only in the block group stage. When clicked, the selection will reset to the most recent block group submission that was sent in. This is nice if you accidentally unselect or want to compare two areas very quickly.

- **Submit Selection / Show Data**  
This button is entirely involved in displaying the data. You must hit Submit Selection until the block group selection is locked and green. Then you can click your filter and the show data button will highlight blue. This means you can now select and view your data.

**Drawer Descriptions:**
- **Filters:**
A pretty simple, yet vitally important drawer to the project. To be mentioned below, no data can be shown without a filter present. The data is in checkbox form, but only one can be selected at a time. When this one is selected, you can check the main bar to see "Selected filter: blank" so that you don't have to open the filters tab to always see your active filter.

- **About the Team:**
This is where we present our Thanks to the Community for Center and Economic Development. It is a great tab to give credit to those who made the project possible: the Southwest Lansing team and the CCED. Roles, Majors, and Contact Information of the team members can be found here

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

