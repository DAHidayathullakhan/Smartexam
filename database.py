import os
import pymongo
from pymongo import MongoClient
from datetime import datetime
from dotenv import load_dotenv

load_dotenv()

# MongoDB URI (MongoDB Atlas or Local MongoDB)
MONGO_URI = os.getenv('MONGO_URI') or os.getenv('MONGODB_URI') or 'mongodb://localhost:27017/smartexam'
DB_NAME = os.getenv('MONGO_DB_NAME', 'smartexam')

db = None
client = None
is_connected = False

class InMemoryCollection:
    def __init__(self, name):
        self.name = name
        self.docs = []
        self._id_counter = 1

    def insert_one(self, doc):
        d = dict(doc)
        if '_id' not in d:
            d['_id'] = self._id_counter
            self._id_counter += 1
        self.docs.append(d)
        class Result:
            inserted_id = d['_id']
        return Result()

    def insert_many(self, docs):
        res = []
        for doc in docs:
            r = self.insert_one(doc)
            res.append(r.inserted_id)
        class Result:
            inserted_ids = res
        return Result()

    def find_one(self, query=None):
        if not query:
            return self.docs[0] if self.docs else None
        for d in self.docs:
            match = True
            for k, v in query.items():
                if d.get(k) != v:
                    match = False
                    break
            if match:
                return d
        return None

    def find(self, query=None):
        if not query:
            return list(self.docs)
        res = []
        for d in self.docs:
            match = True
            for k, v in query.items():
                if d.get(k) != v:
                    match = False
                    break
            if match:
                res.append(d)
        return res

    def update_one(self, filter_q, update_q):
        target = self.find_one(filter_q)
        if target and '$set' in update_q:
            for k, v in update_q['$set'].items():
                target[k] = v
        return True

    def delete_many(self, filter_q):
        self.docs = [d for d in self.docs if not all(d.get(k) == v for k, v in filter_q.items())]
        return True

    def count_documents(self, filter_q=None):
        return len(self.find(filter_q))

class InMemoryMongoDB:
    def __init__(self):
        self.collections = {}

    def __getattr__(self, item):
        if item not in self.collections:
            self.collections[item] = InMemoryCollection(item)
        return self.collections[item]

    def __getitem__(self, item):
        return self.__getattr__(item)

def init_db():
    global db, client, is_connected
    try:
        client = MongoClient(MONGO_URI, serverSelectionTimeoutMS=4000)
        client.admin.command('ping')
        db = client[DB_NAME]
        is_connected = True
        print(f"[MongoDB] Successfully connected to MongoDB Atlas / Database ({DB_NAME})!")
    except Exception as e:
        print(f"[MongoDB Notice] External MongoDB connection: {e}")
        print("[MongoDB Notice] Running in-memory MongoDB fallback mode.")
        db = InMemoryMongoDB()
        is_connected = False

# Initialize MongoDB Connection
init_db()

# Collections as required by SmartExam MongoDB architecture
teachers = db['teachers']
students = db['students']
subjects = db['subjects']
exam_codes = db['exam_codes']
questions = db['questions']
exam_attempts = db['exam_attempts']
results = db['results']
live_classes = db['live_classes']
attendance = db['attendance']
chat_messages = db['chat_messages']
users = db['users']
units = db['units']
notes = db['notes']
notifications = db['notifications']
webrtc_signals = db['webrtc_signals']
