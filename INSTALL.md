Requirements:
<br>- Python 3.14.3
<br>- ArcGIS Online Account
<br>- Render.com account
<br>
<br>Library dependencies can be found in requirements.txt including ideal version numbers.
<br>Use pip install to install the required libraries
<br>
<br>To run the app locally run: uvicorn main:app --reload --host 0.0.0.0 --port 8000
<br>And visit http://localhost:8000/
<br>You will then be prompted to log into ArcGIS Online (which can be done using an MSU login)
<br>
<br>To build the app using Render.com
<br>Utilize this repo or create a fork
<br>Connect the repo to a Render Web Service
<br>Set the build command to: pip install -r requirements.txt
<br>Set the start command to: uvicorn app.main:app --host 0.0.0.0 --port $PORT --proxy-headers --forwarded-allow-ips='*'
<br>
<br>Instructions on how to use the web app can be found in the README