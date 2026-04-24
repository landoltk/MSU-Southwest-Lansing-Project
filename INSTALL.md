Requirements:
<br>- Python 3.14.3
<br>- ArcGIS Online Account
<br>- Render.com account
<br>
<br>Library dependencies can be found in requirements.txt including ideal version numbers.
<br>Use pip install to install the required libraries
<br>```pip install -r requirements.txt```
<br>
<br>To run the app locally enter the app directory using the following command:
<br>```cd app```
<br>Then run the following command to start the app: 
<br>```uvicorn main:app --reload```
<br>
<br>**Render Hosting Instructions:** 
<br>Create an account and sign in 
<br>Create a new Web Service 
<br>Use a public Git Repository and copy in repository link 
<br>https://github.com/landoltk/MSU-Southwest-Lansing-Project.git  
<br>Change name as desired and leave other settings as default 
<br>Set Start Command to the following command:
<br>```uvicorn app.main:app --host 0.0.0.0 --port $PORT --proxy-headers --forwarded-allow-ips='*'```
<br>Select the Free instance type 
<br>Click Deploy Web Service at the bottom 
<br>Wait for the service to deploy then visit the URL under the repository name to test the web app 
<br>If changes are made to the repository, the web app must be redeployed to instantiate the changes 
<br>In the top right of the dashboard click Manual Deploy then click Deploy from latest commit 
<br>This will start up the app again using the latest updated repository from the main branch 
<br>
<br>Instructions on how to use the web app can be found in the README or in the Tutorial section of the app
<br>
<br>Data Pipeline
<br>
<br>All data files are stored externally on ArcGIS and accessed via URL through the ArcGIS API. These data files are sourced from publically available sources like data.census.gov, michigan.data.socrata.com or provided by community partners in the target area.
