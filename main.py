from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from ultralytics import YOLO
import cv2
import base64
import os
import random
import uvicorn
import pyodbc
from datetime import datetime
import json

app = FastAPI()

# Разрешаем CORS
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])

# Загружаем модель YOLO
print("Загрузка ИИ модели...")
try:
    model = YOLO('best.pt')
    print("✅ Модель загружена")
except Exception as e:
    print(f"❌ Ошибка загрузки модели: {e}")
    model = None

# === ПОДКЛЮЧЕНИЕ К SQL SERVER ===
def get_db_connection():
    try:
        conn = pyodbc.connect(
            'DRIVER={ODBC Driver 17 for SQL Server};'
            'SERVER=localhost\\SQLEXPRESS;'
            'DATABASE=VoteSystemDB;'
            'Trusted_Connection=yes;'
            'Encrypt=no;'
        )
        return conn
    except Exception as e:
        print(f"❌ Ошибка подключения к БД: {e}")
        return None

# Проверка подключения при старте
print("Проверка подключения к SQL Server...")
test_conn = get_db_connection()
if test_conn:
    print("✅ SQL Server доступен")
    test_conn.close()
else:
    print("⚠️ SQL Server НЕ ДОСТУПЕН")

def create_incident(district_id, error_code, img_base64):
    """Вспомогательная функция для записи проблемных бланков в БД"""
    conn = get_db_connection()
    if conn:
        try:
            cursor = conn.cursor()
            cursor.execute("""
                INSERT INTO Incidents (DistrictId, ErrorCode, ImagePath, DetectionTime, IsResolved)
                VALUES (?, ?, ?, GETDATE(), 0)
            """, (district_id, error_code, f"data:image/jpeg;base64,{img_base64}"))
            conn.commit()
            conn.close()
        except Exception as e:
            print(f"Ошибка сохранения инцидента: {e}")

# === НАСТРОЙКА ЗОН КАНДИДАТОВ ===
CANDIDATE_ZONES = [
    {"id": 1, "name": "Даванков В.А.", "y_min": 0.15, "y_max": 0.40},
    {"id": 2, "name": "Путин В.В.", "y_min": 0.41, "y_max": 0.6},
    {"id": 3, "name": "Слуцкий Л.Э.", "y_min": 0.61, "y_max": 0.75},
    {"id": 4, "name": "Харитонов Н.М.", "y_min": 0.75, "y_max": 0.95},
]

MARKED_BOX_CLASS_ID = 2

# ======================= API ЭНДПОИНТЫ =======================

@app.get("/test")
async def test():
    return {"status": "ok", "message": "Сервер работает"}

@app.get("/scan")
async def scan_ballot():
    # --- БЛОКИРОВКА ЕСЛИ УЧАСТОК ЗАКРЫТ ---
    conn = get_db_connection()
    if conn:
        try:
            cursor = conn.cursor()
            cursor.execute("SELECT IsActive FROM Districts WHERE Id = 1")
            row = cursor.fetchone()
            conn.close()
            # Если участок ID=1 найден и он закрыт (IsActive = 0)
            if row and row[0] == 0:
                return {"status": "sys_error", "message": "Участок закрыт! Сканирование остановлено."}
        except Exception as e:
            if conn: conn.close()
            print(f"Ошибка проверки статуса участка: {e}")
    # --------------------------------------

    if model is None:
        return {"status": "sys_error", "message": "Модель YOLO не загружена"}
    
    folder = "test_ballots"
    if not os.path.exists(folder) or len(os.listdir(folder)) == 0:
        return {"status": "sys_error", "message": "Папка test_ballots пуста!"}

    photo_name = random.choice(os.listdir(folder))
    image_path = os.path.join(folder, photo_name)
    
    results = model(image_path)
    result = results[0]
    img_height = result.orig_img.shape[0]
    
    marked_boxes = []
    
    for box in result.boxes:
        cls_id = int(box.cls[0])
        conf = float(box.conf[0])
        
        if cls_id == MARKED_BOX_CLASS_ID and conf > 0.65:
            coords = box.xyxy[0].tolist()
            y_center = (coords[1] + coords[3]) / 2
            y_relative = y_center / img_height
            marked_boxes.append(y_relative)
    
    annotated_img = result.plot()
    _, buffer = cv2.imencode('.jpg', annotated_img)
    img_base64 = base64.b64encode(buffer).decode('utf-8')
    
    if len(marked_boxes) == 0:
        create_incident(1, "NO_MARK", img_base64)
        return {"status": "error", "errorType": "NO_MARK", "image_base64": f"data:image/jpeg;base64,{img_base64}"}
    elif len(marked_boxes) > 1:
        create_incident(1, "DOUBLE_MARK", img_base64)
        return {"status": "error", "errorType": "DOUBLE_MARK", "image_base64": f"data:image/jpeg;base64,{img_base64}"}
    else:
        y_mark = marked_boxes[0]
        voted_candidate_id = None
        
        for zone in CANDIDATE_ZONES:
            if zone["y_min"] <= y_mark <= zone["y_max"]:
                voted_candidate_id = zone["id"]
                break
        
        if voted_candidate_id:
            conn = get_db_connection()
            if conn:
                try:
                    cursor = conn.cursor()
                    cursor.execute("""
                        INSERT INTO Ballots (DistrictId, CandidateId, RecordTime, InputMethod, IsValid)
                        VALUES (?, ?, GETDATE(), 'Скан', 1)
                    """, (1, voted_candidate_id))
                    conn.commit()
                    conn.close()
                except Exception as e:
                    print(f"Ошибка сохранения: {e}")
            
            return {"status": "success", "candidate_id": voted_candidate_id, "image_base64": f"data:image/jpeg;base64,{img_base64}"}
        else:
            create_incident(1, "DAMAGED", img_base64)
            return {"status": "error", "errorType": "DAMAGED", "image_base64": f"data:image/jpeg;base64,{img_base64}"}

@app.post("/add-incident")
async def add_incident(data: dict):
    conn = get_db_connection()
    if not conn:
        return JSONResponse(status_code=500, content={"error": "Нет подключения к БД"})
    try:
        cursor = conn.cursor()
        cursor.execute("""
            INSERT INTO Incidents (DistrictId, ErrorCode, ImagePath, DetectionTime, IsResolved)
            VALUES (?, ?, '', GETDATE(), 0)
        """, (data.get("districtId"), data.get("errorCode", "MANUAL_REVIEW")))
        conn.commit()
        conn.close()
        return {"status": "success"}
    except Exception as e:
        conn.close()
        return JSONResponse(status_code=500, content={"error": str(e)})

@app.get("/candidates")
async def get_candidates():
    conn = get_db_connection()
    if not conn:
        return JSONResponse(status_code=500, content={"error": "Нет подключения к БД"})
    try:
        cursor = conn.cursor()
        cursor.execute("""
            SELECT c.Id, c.FullName, c.Party, c.ColorHex, 
                   COUNT(b.Id) as Votes
            FROM Candidates c
            LEFT JOIN Ballots b ON c.Id = b.CandidateId AND b.IsValid = 1
            GROUP BY c.Id, c.FullName, c.Party, c.ColorHex
            ORDER BY Votes DESC
        """)
        candidates = [{"id": r[0], "fullName": r[1], "party": r[2] or '', "colorHex": r[3] or '#4f46e5', "votes": r[4] or 0} for r in cursor.fetchall()]
        conn.close()
        return {"candidates": candidates}
    except Exception as e:
        conn.close()
        return JSONResponse(status_code=500, content={"error": str(e)})

@app.get("/districts")
async def get_districts():
    conn = get_db_connection()
    if not conn:
        return JSONResponse(status_code=500, content={"error": "Нет подключения к БД"})
    try:
        cursor = conn.cursor()
        cursor.execute("SELECT Id, DistrictNumber, Name, Address, VoterCapacity, IsActive FROM Districts")
        
        districts = []
        for row in cursor.fetchall():
            cursor2 = conn.cursor()
            cursor2.execute("SELECT COUNT(*) FROM Ballots WHERE DistrictId = ? AND IsValid = 1", (row[0],))
            voted = cursor2.fetchone()[0]
            cursor2.close()
            
            districts.append({
                "id": row[0],
                "districtNumber": row[1],
                "name": row[2],
                "address": row[3] or '',
                "voterCapacity": row[4],
                "isActive": bool(row[5]),
                "voted": voted,
                "chairman": "Не назначен"
            })
        conn.close()
        return {"districts": districts}
    except Exception as e:
        conn.close()
        return JSONResponse(status_code=500, content={"error": str(e)})

@app.post("/add-district")
async def add_district(data: dict):
    conn = get_db_connection()
    if not conn:
        return JSONResponse(status_code=500, content={"error": "Нет подключения к БД"})
    try:
        cursor = conn.cursor()
        cursor.execute("""
            INSERT INTO Districts (DistrictNumber, Name, Address, VoterCapacity, IsActive)
            VALUES (?, ?, ?, ?, 1)
        """, (data.get("districtNumber"), data.get("name"), data.get("address", ""), data.get("capacity", 0)))
        conn.commit()
        conn.close()
        return {"status": "success", "message": "Участок добавлен"}
    except Exception as e:
        conn.close()
        return JSONResponse(status_code=500, content={"error": str(e)})

@app.post("/toggle-district-status/{district_id}")
async def toggle_district_status(district_id: int):
    conn = get_db_connection()
    if not conn:
        return JSONResponse(status_code=500, content={"error": "Нет подключения к БД"})
    try:
        cursor = conn.cursor()
        cursor.execute("UPDATE Districts SET IsActive = CASE WHEN IsActive=1 THEN 0 ELSE 1 END WHERE Id = ?", (district_id,))
        conn.commit()
        conn.close()
        return {"status": "success"}
    except Exception as e:
        conn.close()
        return JSONResponse(status_code=500, content={"error": str(e)})

@app.get("/stats")
async def get_stats():
    conn = get_db_connection()
    if not conn:
        return JSONResponse(status_code=500, content={"error": "Нет подключения к БД"})
    try:
        cursor = conn.cursor()
        cursor.execute("SELECT COUNT(*) FROM Ballots WHERE IsValid = 1")
        total_votes = cursor.fetchone()[0] or 0
        
        cursor.execute("SELECT COUNT(*) FROM Ballots WHERE IsValid = 0")
        invalid_votes = cursor.fetchone()[0] or 0
        
        cursor.execute("SELECT SUM(VoterCapacity) FROM Districts")
        total_voters = cursor.fetchone()[0] or 0
        
        turnout = (total_votes / total_voters * 100) if total_voters > 0 else 0
        
        cursor.execute("""
            SELECT c.Id, c.FullName, COUNT(b.Id) as Votes
            FROM Candidates c
            LEFT JOIN Ballots b ON c.Id = b.CandidateId AND b.IsValid = 1
            GROUP BY c.Id, c.FullName
        """)
        candidates = [{"id": r[0], "fullName": r[1], "votes": r[2] or 0} for r in cursor.fetchall()]
        conn.close()
        return {
            "totalVotes": total_votes,
            "invalidVotes": invalid_votes,
            "totalVoters": total_voters,
            "turnout": round(turnout, 1),
            "candidates": candidates
        }
    except Exception as e:
        conn.close()
        return JSONResponse(status_code=500, content={"error": str(e)})

@app.get("/incidents")
async def get_incidents():
    conn = get_db_connection()
    if not conn:
        return JSONResponse(status_code=500, content={"error": "Нет подключения к БД"})
    try:
        cursor = conn.cursor()
        cursor.execute("""
            SELECT Id, DistrictId, ErrorCode, ImagePath, DetectionTime, IsResolved
            FROM Incidents
            WHERE IsResolved = 0
            ORDER BY DetectionTime DESC
        """)
        incidents = [{"id": r[0], "districtId": r[1], "errorCode": r[2], "imagePath": r[3], "detectionTime": r[4].isoformat() if r[4] else None, "isResolved": r[5]} for r in cursor.fetchall()]
        conn.close()
        return {"incidents": incidents}
    except Exception as e:
        conn.close()
        return JSONResponse(status_code=500, content={"error": str(e)})

@app.post("/resolve-incident/{incident_id}")
async def resolve_incident(incident_id: int, data: dict):
    conn = get_db_connection()
    if not conn:
        return JSONResponse(status_code=500, content={"error": "Нет подключения к БД"})
    try:
        cursor = conn.cursor()
        verdict = data.get("verdict", "invalid")
        candidate_id = data.get("candidateId")
        operator_id = data.get("operatorId", 1)
        
        cursor.execute("SELECT DistrictId FROM Incidents WHERE Id = ?", (incident_id,))
        district_row = cursor.fetchone()
        if not district_row:
            return JSONResponse(status_code=404, content={"error": "Инцидент не найден"})
        district_id = district_row[0]

        cursor.execute("""
            UPDATE Incidents 
            SET IsResolved = 1, ModeratorVerdict = ?, OperatorId = ?
            WHERE Id = ?
        """, (verdict, operator_id, incident_id))
        
        if verdict == "valid" and candidate_id:
            cursor.execute("""
                INSERT INTO Ballots (DistrictId, CandidateId, RecordTime, InputMethod, IsValid)
                VALUES (?, ?, GETDATE(), 'Модерация', 1)
            """, (district_id, candidate_id))
        elif verdict == "invalid":
            cursor.execute("""
                INSERT INTO Ballots (DistrictId, CandidateId, RecordTime, InputMethod, IsValid)
                VALUES (?, (SELECT TOP 1 Id FROM Candidates), GETDATE(), 'Модерация', 0)
            """, (district_id,))
        
        conn.commit()
        conn.close()
        return {"status": "success", "message": "Инцидент разрешен"}
    except Exception as e:
        conn.close()
        return JSONResponse(status_code=500, content={"error": str(e)})

@app.post("/add-vote")
async def add_vote(data: dict):
    conn = get_db_connection()
    if not conn:
        return JSONResponse(status_code=500, content={"error": "Нет подключения к БД"})
    try:
        cursor = conn.cursor()
        district_id = data.get("districtId")
        candidate_id = data.get("candidateId")
        count = data.get("count", 1)
        for _ in range(count):
            cursor.execute("""
                INSERT INTO Ballots (DistrictId, CandidateId, RecordTime, InputMethod, IsValid)
                VALUES (?, ?, GETDATE(), 'Ручной', 1)
            """, (district_id, candidate_id))
        conn.commit()
        conn.close()
        return {"status": "success"}
    except Exception as e:
        conn.close()
        return JSONResponse(status_code=500, content={"error": str(e)})

@app.post("/add-candidate")
async def add_candidate(data: dict):
    conn = get_db_connection()
    if not conn: return JSONResponse(status_code=500, content={"error": "Нет подключения к БД"})
    try:
        cursor = conn.cursor()
        cursor.execute("INSERT INTO Candidates (CampaignId, FullName, Party, ColorHex) VALUES (1, ?, ?, ?)", 
                       (data.get("fullName"), data.get("party", ""), data.get("colorHex", "#4f46e5")))
        conn.commit()
        conn.close()
        return {"status": "success"}
    except Exception as e:
        conn.close()
        return JSONResponse(status_code=500, content={"error": str(e)})

@app.delete("/delete-candidate/{candidate_id}")
async def delete_candidate(candidate_id: int):
    conn = get_db_connection()
    if not conn: return JSONResponse(status_code=500, content={"error": "Нет подключения к БД"})
    try:
        cursor = conn.cursor()
        cursor.execute("DELETE FROM Candidates WHERE Id = ?", (candidate_id,))
        conn.commit()
        conn.close()
        return {"status": "success"}
    except Exception as e:
        conn.close()
        return JSONResponse(status_code=500, content={"error": str(e)})

@app.get("/voters")
async def get_voters():
    conn = get_db_connection()
    if not conn:
        return JSONResponse(status_code=500, content={"error": "Нет подключения к БД"})
    try:
        cursor = conn.cursor()
        cursor.execute("""
            SELECT Id, Login as Passport, FirstName + ' ' + LastName as FullName, 
                   DistrictId, AccessRole, VoterStatus, IssueCount, VoteTime
            FROM Users
            WHERE AccessRole = 'Избиратель'
        """)
        voters = []
        for row in cursor.fetchall():
            voters.append({
                "id": row[0],
                "passport": row[1],
                "fullName": row[2],
                "districtId": row[3],
                "status": row[5] or "Ожидает",
                "issueCount": row[6] or 0,
                "voteTime": row[7].isoformat() if row[7] else None
            })
        conn.close()
        return {"voters": voters}
    except Exception as e:
        conn.close()
        return JSONResponse(status_code=500, content={"error": str(e)})

@app.post("/add-voter")
async def add_voter(data: dict):
    conn = get_db_connection()
    if not conn: return JSONResponse(status_code=500, content={"error": "Нет подключения к БД"})
    try:
        cursor = conn.cursor()
        cursor.execute("""
            INSERT INTO Users (Login, PasswordHash, FirstName, LastName, AccessRole, DistrictId, VoterStatus, IssueCount)
            VALUES (?, 'N/A', ?, ?, 'Избиратель', ?, 'Ожидает', 0)
        """, (data.get("passport"), data.get("firstName"), data.get("lastName"), data.get("districtId")))
        conn.commit()
        conn.close()
        return {"status": "success"}
    except Exception as e:
        conn.close()
        return JSONResponse(status_code=500, content={"error": str(e)})

@app.post("/update-voter-status")
async def update_voter_status(data: dict):
    conn = get_db_connection()
    if not conn: return JSONResponse(status_code=500, content={"error": "Нет подключения к БД"})
    try:
        cursor = conn.cursor()
        voter_id = data.get("id")
        status = data.get("status")
        
        # ИСПРАВЛЕНИЕ: Увеличиваем счетчик выданных бланков ТОЛЬКО если статус "Выдан"
        if status == "Выдан":
            cursor.execute("""
                UPDATE Users 
                SET VoterStatus = ?, 
                    IssueCount = ISNULL(IssueCount, 0) + 1, 
                    VoteTime = GETDATE() 
                WHERE Id = ?
            """, (status, voter_id))
        else:
            cursor.execute("""
                UPDATE Users 
                SET VoterStatus = ?, 
                    VoteTime = GETDATE() 
                WHERE Id = ?
            """, (status, voter_id))
            
        conn.commit()
        conn.close()
        return {"status": "success"}
    except Exception as e:
        conn.close()
        return JSONResponse(status_code=500, content={"error": str(e)})

@app.post("/spoil-ballot")
async def spoil_ballot(data: dict):
    """Регистрация испорченного бланка в статистике участка"""
    conn = get_db_connection()
    if not conn: return JSONResponse(status_code=500, content={"error": "Нет подключения к БД"})
    try:
        cursor = conn.cursor()
        district_id = data.get("districtId")
        # Записываем бланк со статусом IsValid = 0 (Брак)
        cursor.execute("""
            INSERT INTO Ballots (DistrictId, CandidateId, RecordTime, InputMethod, IsValid)
            VALUES (?, (SELECT TOP 1 Id FROM Candidates), GETDATE(), 'Ручной', 0)
        """, (district_id,))
        conn.commit()
        conn.close()
        return {"status": "success"}
    except Exception as e:
        conn.close()
        return JSONResponse(status_code=500, content={"error": str(e)})

@app.get("/ballots")
async def get_ballots():
    conn = get_db_connection()
    if not conn: return JSONResponse(status_code=500, content={"error": "Нет подключения к БД"})
    try:
        cursor = conn.cursor()
        cursor.execute("""
            SELECT b.Id, b.DistrictId, b.CandidateId, b.RecordTime, b.InputMethod, b.IsValid,
                   c.FullName as CandidateName, d.Name as DistrictName
            FROM Ballots b
            LEFT JOIN Candidates c ON b.CandidateId = c.Id
            LEFT JOIN Districts d ON b.DistrictId = d.Id
            ORDER BY b.RecordTime DESC
        """)
        ballots = [{"id": r[0], "districtId": r[1], "candidateId": r[2], "recordTime": r[3].isoformat() if r[3] else None, "inputMethod": r[4], "isValid": r[5], "candidateName": r[6] or 'Неизвестно', "districtName": r[7] or 'Неизвестно'} for r in cursor.fetchall()]
        conn.close()
        return {"ballots": ballots}
    except Exception as e:
        conn.close()
        return JSONResponse(status_code=500, content={"error": str(e)})

@app.get("/elections")
async def get_elections():
    conn = get_db_connection()
    if not conn: return JSONResponse(status_code=500, content={"error": "Нет подключения к БД"})
    try:
        cursor = conn.cursor()
        cursor.execute("SELECT Id, Name, ElectionType, Description, StartDate, EndDate, Status FROM Campaigns ORDER BY StartDate DESC")
        elections = [{"id": r[0], "name": r[1], "type": r[2], "description": r[3] or '', "startDate": r[4].isoformat() if r[4] else None, "endDate": r[5].isoformat() if r[5] else None, "status": r[6]} for r in cursor.fetchall()]
        conn.close()
        return {"elections": elections}
    except Exception as e:
        conn.close()
        return JSONResponse(status_code=500, content={"error": str(e)})

@app.post("/add-election")
async def add_election(data: dict):
    conn = get_db_connection()
    if not conn: return JSONResponse(status_code=500, content={"error": "Нет подключения к БД"})
    try:
        cursor = conn.cursor()
        cursor.execute("INSERT INTO Campaigns (Name, ElectionType, Description, StartDate, EndDate, Status) VALUES (?, ?, ?, ?, ?, ?)", 
                       (data.get("name"), data.get("type", "Региональные"), data.get("description", ""), data.get("startDate"), data.get("endDate"), data.get("status", "upcoming")))
        conn.commit()
        conn.close()
        return {"status": "success"}
    except Exception as e:
        conn.close()
        return JSONResponse(status_code=500, content={"error": str(e)})

@app.get("/analytics/hourly")
async def get_hourly_turnout():
    """Получение статистики голосов по часам"""
    conn = get_db_connection()
    if not conn:
        return JSONResponse(status_code=500, content={"error": "Нет подключения к БД"})
    try:
        cursor = conn.cursor()
        # SQL Server функция DATEPART извлекает час из времени
        cursor.execute("""
            SELECT DATEPART(HOUR, RecordTime) as Hour, COUNT(*) as Votes
            FROM Ballots
            WHERE IsValid = 1
            GROUP BY DATEPART(HOUR, RecordTime)
            ORDER BY Hour
        """)
        data = {str(row[0]): row[1] for row in cursor.fetchall()}
        conn.close()
        return {"hourly": data}
    except Exception as e:
        conn.close()
        return JSONResponse(status_code=500, content={"error": str(e)})

@app.get("/analytics/methods")
async def get_input_methods():
    """Получение статистики по источникам ввода бланков"""
    conn = get_db_connection()
    if not conn:
        return JSONResponse(status_code=500, content={"error": "Нет подключения к БД"})
    try:
        cursor = conn.cursor()
        cursor.execute("""
            SELECT InputMethod, COUNT(*) as Count
            FROM Ballots
            GROUP BY InputMethod
        """)
        data = {row[0]: row[1] for row in cursor.fetchall()}
        conn.close()
        return {"methods": data}
    except Exception as e:
        conn.close()
        return JSONResponse(status_code=500, content={"error": str(e)})

@app.get("/analytics/benford")
async def get_benford():
    conn = get_db_connection()
    if not conn: return JSONResponse(status_code=500, content={"error": "Нет подключения к БД"})
    try:
        cursor = conn.cursor()
        cursor.execute("SELECT CandidateId, COUNT(*) as Count FROM Ballots WHERE IsValid = 1 GROUP BY CandidateId")
        votes = [r[1] for r in cursor.fetchall()]
        observed = [0] * 9
        for v in votes:
            if v > 0:
                first_digit = int(str(v)[0])
                if 1 <= first_digit <= 9: observed[first_digit - 1] += 1
        expected = [30.1, 17.6, 12.5, 9.7, 7.9, 6.7, 5.8, 5.1, 4.6]
        total_observed = sum(observed) or 1
        observed_percent = [(o / total_observed) * 100 for o in observed]
        is_compliant = all(abs(observed_percent[i] - expected[i]) <= 15 for i in range(9))
        conn.close()
        return {"observed": observed_percent, "expected": expected, "isCompliant": is_compliant}
    except Exception as e:
        conn.close()
        return JSONResponse(status_code=500, content={"error": str(e)})

if __name__ == "__main__":
    uvicorn.run("main:app", host="127.0.0.1", port=8000, reload=True)