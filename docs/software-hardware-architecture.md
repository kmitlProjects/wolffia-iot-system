# Software-Hardware Architecture Diagram

This Mermaid diagram is based on the current codebase and runtime behavior of the project.

How to edit:
- update the Mermaid block below in any text editor
- preview in VS Code Mermaid/Markdown preview or paste into https://mermaid.live

```mermaid
flowchart LR
    Browser["Mobile / Browser<br/>Dashboard UI"]

    subgraph PI["Raspberry Pi 5 Edge Node"]
        direction TB

        Systemd["systemd service<br/>wolffia-stack.service"]
        RunStack["run_stack.sh<br/>starts 3 long-running processes"]

        subgraph SW["Software Runtime"]
            direction TB
            APIP["FastAPI Backend + Frontend<br/>api/api.py + frontend/dist"]
            Pub["MQTT Publisher<br/>mqtt/publisher.py"]
            Sub["MQTT Subscriber<br/>mqtt/subscriber.py"]
            Broker["Local MQTT Broker"]
            DB[("MongoDB<br/>sensor_data<br/>daily_image_analysis<br/>daily_summary<br/>grow_cycles<br/>automation_rules<br/>prediction_runs<br/>anomaly_alerts")]
            CameraSvc["Camera Service<br/>camera/camera.py"]
            Coverage["OpenCV Coverage Analysis<br/>ai/coverage.py"]
            Daily["Daily Image Scheduler<br/>automation/daily_capture.py"]
            Sched["Automation Scheduler<br/>automation/scheduler.py"]
            Anom["Anomaly Watcher<br/>automation/anomaly_watch.py"]
            Grow["Grow Cycle Logic<br/>grow_cycle.py"]
            Predict["Harvest Prediction Runtime<br/>ai/predictions.py"]
            Act["Actuator Controllers<br/>actuators/*"]
        end

        subgraph HW["Hardware I/O"]
            direction TB
            DS["DS18B20<br/>1-Wire GPIO4"]
            PH["pH Sensor Module"]
            ADC["MCP3008 ADC<br/>SPI0 CE0"]
            SPINote["SPI0 pins<br/>MOSI GPIO10<br/>MISO GPIO9<br/>SCLK GPIO11<br/>CE0 GPIO8"]
            Cam["USB Camera<br/>/dev/video0"]
            Relay["Relay Board<br/>GPIO19 GPIO16 GPIO5 GPIO6 GPIO13"]
            Light["Grow Light"]
            Water["Water Pump"]
            Fert1["Fertilizer Pump 1"]
            Fert2["Fertilizer Pump 2"]
            Fert3["Fertilizer Pump 3"]
        end
    end

    subgraph EXT["External / Offline AI Training"]
        direction TB
        Export["Dataset Export<br/>from MongoDB"]
        Synth["Synthetic / Bootstrap Dataset"]
        Colab["Offline Training<br/>Google Colab / local notebook"]
        Model["Deployed Baseline Model Files<br/>data/train/*.joblib + metrics JSON"]
        Note["Note: current AI baseline uses partly synthetic data<br/>because real-world dataset is still limited."]
    end

    Browser <-->|HTTP / dashboard control| APIP

    Systemd --> RunStack
    RunStack --> APIP
    RunStack --> Pub
    RunStack --> Sub

    DS -->|temperature| Pub
    PH -->|analog pH output| ADC
    SPINote -.-> ADC
    ADC -->|CH0 via SPI| Pub

    Pub -->|MQTT publish| Broker
    Broker -->|MQTT subscribe| Sub
    Sub -->|store sensor records| DB
    Sub -->|attach active cycle context| Grow

    APIP -->|read/write dashboard state, rules, history| DB
    APIP -->|startup threads| Sched
    APIP -->|startup threads| Daily
    APIP -->|startup threads| Anom
    APIP -->|control endpoints| Act
    APIP -->|prediction endpoints| Predict
    APIP -->|grow cycle endpoints| Grow
    Grow -->|persist cycle documents| DB

    Cam -->|video frames| CameraSvc
    APIP -->|frame requests / video endpoint| CameraSvc
    Daily -->|scheduled capture| CameraSvc
    Anom -->|frame inspection| CameraSvc

    Daily -->|temporary light off/on during capture| Act
    Daily -->|lookup active cycle| Grow
    Daily -->|green coverage analysis| Coverage
    Coverage -->|coverage result + previews| Daily
    Daily -->|image_analysis + daily_summary| DB

    Anom -->|ROI extraction + coverage helper| Coverage
    Anom -->|alert records + preview assets| DB

    Predict -->|load model files| Model
    DB -->|sensor history + summaries + cycle context| Predict

    Sched -->|time-based control| Act
    Act --> Relay
    Relay --> Light
    Relay --> Water
    Relay --> Fert1
    Relay --> Fert2
    Relay --> Fert3

    DB -->|training exports| Export
    Export --> Colab
    Synth --> Colab
    Colab -->|trained baseline artifacts| Model
    Note -.-> Colab

    classDef client fill:#dbeafe,stroke:#1d4ed8,color:#111827
    classDef runtime fill:#e0f2fe,stroke:#0284c7,color:#111827
    classDef storage fill:#fef3c7,stroke:#d97706,color:#111827
    classDef hardware fill:#fee2e2,stroke:#dc2626,color:#111827
    classDef external fill:#ede9fe,stroke:#7c3aed,color:#111827
    classDef note fill:#f3f4f6,stroke:#6b7280,color:#111827,stroke-dasharray: 5 5

    class Browser client
    class Systemd,RunStack,APIP,Pub,Sub,Broker,CameraSvc,Coverage,Daily,Sched,Anom,Grow,Predict,Act runtime
    class DB storage
    class DS,PH,ADC,SPINote,Cam,Relay,Light,Water,Fert1,Fert2,Fert3 hardware
    class Export,Synth,Colab,Model external
    class Note note
```
