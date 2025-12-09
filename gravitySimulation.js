const canvas = document.getElementById('simulationCanvas');
const ctx = canvas.getContext('2d');

const G = 0.02;
const COLLISION_ENERGY_THRESHOLD = 30; 
const BASE_DENSITY = 50; 

const SPECIFIC_HEAT = 4.2; 
const COOLING_RATE = 0.005; 
const RADIATION_TRANSFER_RATE = 0.0001;

// 【追加設定】
// ガス抵抗係数（宇宙空間の摩擦）。小さい粒子ほど強く影響を受ける
const GAS_DRAG_COEFFICIENT = 0.005; 
// ダスト凝集係数。小さい粒子同士は半径の何倍で吸着するか
const DUST_ACCRETION_RADIUS_MULTIPLIER = 4.0;
// これ以下の質量は「ダスト」とみなし、摩擦と凝集を強くする
const DUST_MASS_THRESHOLD = 50; 

let objects = [];
let newObjects = [];

function getHeatColor(temp, alpha = 1) {
    if (temp < 10) return `rgba(100, 100, 255, ${alpha})`; 
    if (temp < 50) {
        let r = Math.min(255, (temp - 10) * 6);
        let b = Math.max(0, 255 - (temp - 10) * 6);
        return `rgba(${r}, 50, ${b}, ${alpha})`;
    }
    if (temp < 100) {
        let g = Math.min(255, (temp - 50) * 5);
        return `rgba(255, ${g}, 0, ${alpha})`;
    }
    let b = Math.min(255, (temp - 100) * 5);
    return `rgba(255, 255, ${b}, ${alpha})`;
}

class Object {
    constructor(x, y, mass, vx = (Math.random() - 0.5) * 2, vy = (Math.random() - 0.5) * 2, temp = 0, density = BASE_DENSITY) {
        this.x = x;
        this.y = y;
        this.mass = mass;
        this.vx = vx;
        this.vy = vy;
        this.ax = 0;
        this.ay = 0;
        this.temperature = temp;
        this.density = density;
        this.radius = Math.sqrt(this.mass / this.density);
        this.cooldown = 5; 
    }

    draw() {
        // ダストは大きく薄く
        ctx.beginPath();
        let drawRadius = Math.max(1.5, this.mass < DUST_MASS_THRESHOLD ? this.radius*10 : this.radius); 
        ctx.arc(this.x, this.y, drawRadius, 0, Math.PI * 2);
        ctx.fillStyle = this.mass < DUST_MASS_THRESHOLD ? getHeatColor(this.temperature, 0.2) : getHeatColor(this.temperature, 1); // 色はそのまま使用
        ctx.fill();
        ctx.closePath();

        // 巨大天体(恒星)の周りのガス円盤演出
        if (this.mass > 500) {
             ctx.beginPath();
             ctx.arc(this.x, this.y, this.radius * 2.5, 0, Math.PI * 2);
             ctx.strokeStyle = `rgba(255, 255, 255, 0.22)`;
             ctx.stroke();
             ctx.closePath();
        }
    }

    update() {
        if (this.cooldown > 0) this.cooldown--;

        // 1. 放射冷却
        let lostTemp = this.temperature * COOLING_RATE;
        this.temperature -= lostTemp;
        if (this.temperature < 0) this.temperature = 0;

        // 【追加機能1】ガス抵抗 (Gas Drag)
        // 質量が小さいほど空気抵抗（ガス抵抗）を大きく受ける
        // これにより、小さな破片は時間とともに減速し、大きな星に落ちるか、集まって塊になりやすくなる
        let dragFactor = 1.0;
        if (this.mass < DUST_MASS_THRESHOLD) {
            // 軽いほど減速する (1.0 = 減速なし, 0.99 = 1%減速)
            // mass=1 のとき強く、mass=50 に近づくと弱くなる
            let dragStrength = GAS_DRAG_COEFFICIENT * (1 - this.mass / DUST_MASS_THRESHOLD);
            if (dragStrength < 0) dragStrength = 0;
            dragFactor = 1.0 - dragStrength;
        }
        
        // 速度の減衰
        this.vx *= dragFactor;
        this.vy *= dragFactor;


        this.ax = 0;
        this.ay = 0;

        for (let other of objects) {
            if (other !== this) {
                let dx = other.x - this.x;
                let dy = other.y - this.y;
                let distanceSquared = dx * dx + dy * dy;

                if (distanceSquared === 0) continue;
                
                let distance = Math.sqrt(distanceSquared);
                if (distance < 1) distance = 1; 

                // 重力計算
                let forceMagnitude = G * this.mass * other.mass / (distance * distance);
                let directionFactor = 1 / distance;
                this.ax += (dx * forceMagnitude * directionFactor) / this.mass;
                this.ay += (dy * forceMagnitude * directionFactor) / this.mass;

                // 放射熱の受光
                let otherSurfaceArea = other.radius * other.radius;
                let receivedHeat = (other.temperature * otherSurfaceArea * RADIATION_TRANSFER_RATE) / distanceSquared;
                this.temperature += receivedHeat / this.mass; 
            }
        }

        this.vx += this.ax;
        this.vy += this.ay;
        this.x += this.vx;
        this.y += this.vy;

        // 衝突判定
        for (let i = 0; i < objects.length; i++) {
            let other = objects[i];
            if (other !== this && this.cooldown <= 0 && other.cooldown <= 0) {
                let dx = other.x - this.x;
                let dy = other.y - this.y;
                let distanceSquared = dx * dx + dy * dy;
                let minDistance = this.radius + other.radius;

                // 【追加機能2】ダスト凝集 (Dust Aggregation)
                // 両方が小さい粒子(ダスト)の場合、衝突判定範囲を広げて「くっつきやすく」する
                if (this.mass < DUST_MASS_THRESHOLD && other.mass < DUST_MASS_THRESHOLD) {
                    minDistance *= DUST_ACCRETION_RADIUS_MULTIPLIER;
                }

                if (distanceSquared < minDistance * minDistance) {
                    if (!objects.includes(this) || !objects.includes(other)) continue;

                    let keBefore = 0.5 * this.mass * (this.vx**2 + this.vy**2) + 
                                   0.5 * other.mass * (other.vx**2 + other.vy**2);
                    let collisionEnergy = keBefore; 

                    let energy_threshold = COLLISION_ENERGY_THRESHOLD;

                    if(this.mass < DUST_MASS_THRESHOLD && other.mass < DUST_MASS_THRESHOLD) {
                        // 両方がダストなら閾値を上げて合体しやすく
                        energy_threshold *= 20;
                        // 高温のダストは合体しない
                        let tempSum = this.temperature + other.temperature;
                        if (tempSum > 100) {
                            energy_threshold *= 1000;
                        }
                    } else if (this.mass > DUST_MASS_THRESHOLD*10 && other.mass > DUST_MASS_THRESHOLD*10) {
                        // 両方が大きな天体なら閾値を下げて破壊しやすく
                        energy_threshold /= (this.mass + other.mass) / 2000; 
                    }

                    if (collisionEnergy > energy_threshold * (this.mass + other.mass)) {
                        let massRatio = this.mass / other.mass;

                        if (massRatio > 4.0) {
                            this.crater(other, keBefore);
                        } else if (massRatio < 0.25) {
                            other.crater(this, keBefore);
                        } else {
                            this.fragment(other, keBefore);
                        }
                        break; 
                    } else {
                        // 合体（凝集）
                        this.merge(other, keBefore);
                        break;
                    }
                }
            }
        }

        if (this.x + this.radius > canvas.width || this.x - this.radius < 0) this.vx *= -1;
        if (this.y + this.radius > canvas.height || this.y - this.radius < 0) this.vy *= -1;

        this.draw();
    }

    crater(impactor, totalEnergyBefore) {
        const HEAT_LOSS_RATIO = 0.95; 
        
        let impactorEnergy = 0.5 * impactor.mass * (impactor.vx**2 + impactor.vy**2);
        let energyToHeat = impactorEnergy * HEAT_LOSS_RATIO;
        let energyToMotion = impactorEnergy * (1 - HEAT_LOSS_RATIO);

        this.temperature += energyToHeat / (this.mass * SPECIFIC_HEAT);

        const EXCAVATION_EFFICIENCY = 0.8; 
        let excavatedMass = (impactorEnergy / 50) * EXCAVATION_EFFICIENCY;
        if (excavatedMass > this.mass * 0.15) excavatedMass = this.mass * 0.15;

        this.mass -= excavatedMass;
        this.radius = Math.sqrt(this.mass / this.density);

        let debrisMassTotal = impactor.mass + excavatedMass;
        let numFragments = Math.floor(debrisMassTotal / 5) + 3; 
        
        let angleToImpactor = Math.atan2(impactor.y - this.y, impactor.x - this.x);
        let impactX = this.x + Math.cos(angleToImpactor) * this.radius;
        let impactY = this.y + Math.sin(angleToImpactor) * this.radius;

        let remainingDebris = debrisMassTotal;

        for (let i = 0; i < numFragments; i++) {
            let fragMass = (debrisMassTotal / numFragments) * (0.5 + Math.random());
            if (i === numFragments - 1) fragMass = remainingDebris;
            remainingDebris -= fragMass;
            if (fragMass < 0.1) continue;

            let spreadAngle = (Math.random() - 0.5) * 2.0; 
            let debrisAngle = angleToImpactor + spreadAngle;

            let speed = Math.sqrt(energyToMotion / debrisMassTotal) * (0.5 + Math.random() * 1.5);
            
            let vxFrag = this.vx + Math.cos(debrisAngle) * speed;
            let vyFrag = this.vy + Math.sin(debrisAngle) * speed;

            let spawnX = impactX + Math.cos(debrisAngle) * 2;
            let spawnY = impactY + Math.sin(debrisAngle) * 2;

            newObjects.push(new Object(spawnX, spawnY, fragMass, vxFrag, vyFrag, this.temperature + 50));
        }

        let idx = objects.indexOf(impactor);
        if (idx > -1) objects.splice(idx, 1);
        
        this.vx += (impactor.mass * impactor.vx) / this.mass * 0.2;
        this.vy += (impactor.mass * impactor.vy) / this.mass * 0.2;
    }

    fragment(other, totalEnergyBefore) {
        let totalMass = this.mass + other.mass;
        let comVx = (this.vx * this.mass + other.vx * other.mass) / totalMass;
        let comVy = (this.vy * this.mass + other.vy * other.mass) / totalMass;
        let comEnergy = 0.5 * totalMass * (comVx**2 + comVy**2);
        let availableEnergy = totalEnergyBefore - comEnergy;

        const HEAT_LOSS_RATIO = 0.95; 
        
        let energyToHeat = availableEnergy * HEAT_LOSS_RATIO;
        let energyToMotion = availableEnergy * (1 - HEAT_LOSS_RATIO);

        let tempRise = energyToHeat / (totalMass * SPECIFIC_HEAT);
        let avgTemp = (this.temperature * this.mass + other.temperature * other.mass) / totalMass;
        let finalTemp = avgTemp + tempRise;

        let numFragments = Math.floor(totalMass / 10) + 2; 
        let remainingMass = totalMass;
        
        let fragments = [];

        for (let i = 0; i < numFragments; i++) {
            let fragmentMass;
            if (i === numFragments - 1) {
                fragmentMass = remainingMass;
            } else {
                fragmentMass = (totalMass / numFragments) * (0.5 + Math.random());
                if (fragmentMass >= remainingMass) fragmentMass = remainingMass * 0.5;
            }
            remainingMass -= fragmentMass;
            if (fragmentMass < 0.1) continue;

            let angle = Math.random() * Math.PI * 2;
            let rawSpeed = Math.random() * 0.5 + 0.5; 
            fragments.push({
                mass: fragmentMass,
                vxRel: Math.cos(angle) * rawSpeed,
                vyRel: Math.sin(angle) * rawSpeed
            });
        }

        let currentKE = 0;
        for (let f of fragments) currentKE += 0.5 * f.mass * (f.vxRel**2 + f.vyRel**2);

        let scale = 0;
        if (currentKE > 0) scale = Math.sqrt(energyToMotion / currentKE);

        for (let f of fragments) {
            let finalVx = comVx + f.vxRel * scale;
            let finalVy = comVy + f.vyRel * scale;
            
            let spawnRadius = Math.sqrt(totalMass / BASE_DENSITY) * 1.5;
            let dirAngle = Math.atan2(f.vyRel, f.vxRel);
            
            newObjects.push(new Object(
                this.x + Math.cos(dirAngle) * spawnRadius, 
                this.y + Math.sin(dirAngle) * spawnRadius, 
                f.mass, finalVx, finalVy, finalTemp
            ));
        }

        let idx1 = objects.indexOf(this);
        if (idx1 > -1) objects.splice(idx1, 1);
        let idx2 = objects.indexOf(other);
        if (idx2 > -1) objects.splice(idx2, 1);
    }

    merge(other, keBefore) {
        let mergedMass = this.mass + other.mass;
        let finalVx = (this.vx * this.mass + other.vx * other.mass) / mergedMass;
        let finalVy = (this.vy * this.mass + other.vy * other.mass) / mergedMass;

        let keAfter = 0.5 * mergedMass * (finalVx**2 + finalVy**2);
        let heatGenerated = (keBefore - keAfter) * SPECIFIC_HEAT;

        let newTemp = (this.temperature * this.mass + other.temperature * other.mass) / mergedMass;
        newTemp += heatGenerated / mergedMass;
        
        this.x = (this.x * this.mass + other.x * other.mass) / mergedMass;
        this.y = (this.y * this.mass + other.y * other.mass) / mergedMass;
        this.vx = finalVx;
        this.vy = finalVy;
        this.mass = mergedMass;
        this.temperature = newTemp;
        this.density = BASE_DENSITY;
        this.radius = Math.sqrt(this.mass / this.density);
        
        let index = objects.indexOf(other);
        if (index > -1) objects.splice(index, 1);
    }
}

function addPlanet() {
    let x = Math.random() * canvas.width;
    let y = Math.random() * canvas.height;
    // 巨大天体と小天体が混在するようにランダム幅を拡大
    let mass = (Math.random() ** 3) * 100 + 10; 
    objects.push(new Object(x, y, mass, undefined, undefined, 10));
}

function init() {
    for (let i = 0; i < 300; i++) { // 数を増やして「ダスト感」を出す
        addPlanet();
    }
}

function updateAndRender() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = 'black';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    let currentObjects = [...objects];
    
    for (let obj of currentObjects) {
        if (objects.includes(obj)) {
            obj.update();
        }
    }

    if (newObjects.length > 0) {
        objects.push(...newObjects);
        newObjects = [];
    }

    requestAnimationFrame(updateAndRender);
}

init();
updateAndRender();

function addPlanetCount(count) {
    for (let i = 0; i < count; i++) {
        addPlanet();
    }
}