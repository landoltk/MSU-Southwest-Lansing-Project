Requirements:
<br>- Python 3.14.3
<br>- ArcGIS Online Account
<br>- Render.com account
<br>
<br>Library dependencies can be found in requirements.txt including ideal version numbers.
<br>Use pip install to install the required libraries
<br>
<br>To run the app locally enter the app directory using the following command:
<br>'''cd app'''
<br>Then run the following command to start the app: 
<br>'''uvicorn main:app --reload'''
<br>
<br>To build the app using Render.com
<br>Utilize this repo or create a fork
<br>Connect the repo to a Render Web Service
<br>Set the build command to: pip install -r requirements.txt
<br>Set the start command to: uvicorn app.main:app --host 0.0.0.0 --port $PORT --proxy-headers --forwarded-allow-ips='*'
<br>
<br>Instructions on how to use the web app can be found in the README
<br>
<br>Data Pipeline
<br>
<br>All data files are stored externally on ArcGIS and accessed via URL through the ArcGIS API. These data files are sourced from publically available sources like data.census.gov, michigan.data.socrata.com or provided by community partners in the target area.
