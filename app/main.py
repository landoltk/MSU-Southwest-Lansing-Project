from fastapi import FastAPI, HTTPException
from fastapi.staticfiles import StaticFiles
from pathlib import Path
from census import Census
from dotenv import load_dotenv
import os

load_dotenv("apikey.env")

app = FastAPI(title="SWLP Prototype App", version="0.1.0")

BASE_DIR = Path(__file__).resolve().parent
STATIC_DIR = BASE_DIR / "static"

CENSUS_API_KEY = os.getenv("CENSUS_API_KEY")

if not CENSUS_API_KEY:
    raise RuntimeError(
        "CENSUS_API_KEY is not set. Add it to a local .env file or your Render environment variables."
    )

c = Census(CENSUS_API_KEY)


@app.get("/api/race")
def get_race_data():
    try:
        vars_to_get = (
            "NAME",
            "B02001_001E",
            "B02001_002E",
            "B02001_003E",
            "B02001_004E",
            "B02001_005E",
            "B02001_006E",
            "B02001_007E",
            "B02001_008E",
        )

        counties = ["065", "045", "037"]
        results = {}

        for county in counties:
            rows = c.acs5.get(
                vars_to_get,
                {
                    "for": "block group:*",
                    "in": f"state:26 county:{county} tract:*"
                },
                year=2020
            )

            for row in rows:
                geoid = f"26{row['county']}{row['tract']}{row['block group']}"
                results[geoid] = {
                    "name": row.get("NAME", ""),
                    "race_total": int(row.get("B02001_001E", 0) or 0),
                    "race_white": int(row.get("B02001_002E", 0) or 0),
                    "race_black": int(row.get("B02001_003E", 0) or 0),
                    "race_native": int(row.get("B02001_004E", 0) or 0),
                    "race_asian": int(row.get("B02001_005E", 0) or 0),
                    "race_pacific": int(row.get("B02001_006E", 0) or 0),
                    "race_other": int(row.get("B02001_007E", 0) or 0),
                    "race_two_plus": int(row.get("B02001_008E", 0) or 0),
                }

        return results

    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/income")
def get_income_data():
    try:
        vars_to_get = (
            "NAME",
            "B19013_001E",
        )

        counties = ["065", "045", "037"]
        results = {}

        for county in counties:
            rows = c.acs5.get(
                vars_to_get,
                {
                    "for": "block group:*",
                    "in": f"state:26 county:{county} tract:*"
                },
                year=2020
            )

            for row in rows:
                geoid = f"26{row['county']}{row['tract']}{row['block group']}"
                raw_income = row.get("B19013_001E", None)

                income_val = None
                if raw_income not in [None, "", "-666666666"]:
                    try:
                        income_val = int(raw_income)
                    except Exception:
                        income_val = None

                results[geoid] = {
                    "name": row.get("NAME", ""),
                    "income_median": income_val
                }

        return results

    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/household")
def get_household_data():
    try:
        vars_to_get = (
            "NAME",
            "B25010_001E",
            "B25010_002E",
            "B25010_003E",
        )

        counties = ["065", "045", "037"]
        results = {}

        def clean_float(value):
            if value in [None, "", "-666666666"]:
                return None
            try:
                return float(value)
            except Exception:
                return None

        for county in counties:
            rows = c.acs5.get(
                vars_to_get,
                {
                    "for": "block group:*",
                    "in": f"state:26 county:{county} tract:*"
                },
                year=2020
            )

            for row in rows:
                geoid = f"26{row['county']}{row['tract']}{row['block group']}"
                results[geoid] = {
                    "name": row.get("NAME", ""),
                    "household_total": clean_float(row.get("B25010_001E")),
                    "household_owner": clean_float(row.get("B25010_002E")),
                    "household_renter": clean_float(row.get("B25010_003E")),
                }

        return results

    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


app.mount("/static", StaticFiles(directory=str(STATIC_DIR)), name="static")
app.mount("/", StaticFiles(directory=str(BASE_DIR), html=True), name="root")