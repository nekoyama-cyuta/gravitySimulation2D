const canvas = document.getElementById('simulationCanvas');
const ctx = canvas.getContext('2d');

const G = 0.02;
const COLLISION_ENERGY_THRESHOLD = 30; 
const BASE_DENSITY = 50; 

const SPECIFIC_HEAT = 4.2; 
const COOLING_RATE = 0.005; 
const RADIATION_TRANSFER_RATE = 0.0001;

const GAS_DRAG_COEFFICIENT = 0.005; 
const DUST_ACCRETION_RADIUS_MULTIPLIER = 4.0;
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
    constructor(x, y, mass, vx, vy, axIgnored, ayIgnored, temp = 0, density = BASE_DENSITY, radiusIgnored, cooldown = 5) {
        this.x = x;
        this.y = y;
        this.mass = mass;
        this.vx = vx || (Math.random() - 0.5) * 0;
        this.vy = vy || (Math.random() - 0.5) * 0;
        this.ax = 0;
        this.ay = 0;
        this.temperature = temp;
        this.density = density || BASE_DENSITY;
        this.radius = Math.sqrt(this.mass / this.density);
        this.cooldown = cooldown;
    }

    draw() {
        ctx.beginPath();
        let drawRadius = Math.max(1.5, this.mass < DUST_MASS_THRESHOLD ? this.radius*1 : this.radius); 
        ctx.arc(this.x, this.y, drawRadius, 0, Math.PI * 2);
        ctx.fillStyle = getHeatColor(this.temperature, 1);
        ctx.fill();
        ctx.closePath();

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

        // ガス抵抗
        let dragFactor = 1.0;
        if (this.mass < DUST_MASS_THRESHOLD) {
            let dragStrength = GAS_DRAG_COEFFICIENT * (1 - this.mass / DUST_MASS_THRESHOLD);
            if (dragStrength < 0) dragStrength = 0;
            dragFactor = 1.0 - dragStrength;
        }
        
        this.vx *= dragFactor;
        this.vy *= dragFactor;

        this.ax = 0;
        this.ay = 0;

        // クールダウン中は「重力計算のみ」スキップ
        
        if (this.cooldown <= 0) {
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
        }

        // 速度と位置の更新
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
                        energy_threshold *= 20;
                        let tempSum = this.temperature + other.temperature;
                        if (tempSum > 50) continue;
                    } else if (this.mass > DUST_MASS_THRESHOLD*10 && other.mass > DUST_MASS_THRESHOLD*10) {
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
                        this.merge(other, keBefore);
                        break;
                    }
                }
            }
        }

        // 画面外反射
        if (this.x + this.radius > canvas.width || this.x - this.radius < 0) this.vx *= -1;
        if (this.y + this.radius > canvas.height || this.y - this.radius < 0) this.vy *= -1;

        // 描画
        this.draw();
    }

    crater(impactor, totalEnergyBefore) {
        const HEAT_LOSS_RATIO = 0.8; 
        
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

            newObjects.push(new Object(
                spawnX, 
                spawnY, 
                fragMass, 
                vxFrag, 
                vyFrag,
                undefined, // ax
                undefined, // ay
                this.temperature + 50, // temp
                undefined, // density
                Math.sqrt(fragMass / this.density), // radius
                5 // cooldown
            ));
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

        const HEAT_LOSS_RATIO = 0.8; 
        
        let energyToHeat = availableEnergy * HEAT_LOSS_RATIO;
        let energyToMotion = availableEnergy * (1 - HEAT_LOSS_RATIO);

        let tempRise = energyToHeat / (totalMass * SPECIFIC_HEAT);
        let finalTemp = (this.temperature * this.mass + other.temperature * other.mass) / totalMass + tempRise;
        finalTemp *= 10; // 演出用に温度上昇を強調

        // 1. 個数の決定と割り振り (2:8)
        let totalFragments = Math.floor(totalMass / 5) + 4; // 少し最低数を確保
        let numJets = Math.max(2, Math.floor(totalFragments * 0.2)); // 全体の2割を噴射用（最低2個）
        let numScatter = totalFragments - numJets;           // 残りを拡散用

        let remainingMass = totalMass;
        let normalAngle = Math.atan2(other.y - this.y, other.x - this.x);
        
        let fragments = [];

        // 共通の質量計算関数
        const getFragmentMass = (count) => {
            if (count <= 1) return remainingMass;
            let m = (totalMass / totalFragments) * (0.5 + Math.random()); 
            if (m >= remainingMass) m = remainingMass * 0.5;
            remainingMass -= m;
            return m;
        };

        // 2. 噴射（Jets）の生成処理
        // 衝突面に対して垂直方向（±90度）へ鋭く飛び出す
        for (let i = 0; i < numJets; i++) {
            let m = getFragmentMass(numJets + numScatter - i); // 残りの総数で計算
            if (m < 0.1) continue;

            // 垂直方向(PI/2) または 反対(-PI/2) に絞る
            let baseAngle = normalAngle + (Math.PI / 2);
            if (Math.random() < 0.5) baseAngle += Math.PI; // 50%で反対側
            
            // 角度のブレ幅を小さくして「噴射」感を出す
            let angle = baseAngle + (Math.random() - 0.5) * 0.4; 

            fragments.push({
                mass: m,
                vxRel: Math.cos(angle) * 5, // 初速を速く設定(5)
                vyRel: Math.sin(angle) * 5,
                type: 'jet', // 識別用タグ
                angle: angle
            });
        }

        // 3. 全方向拡散（Scatter）の生成処理
        // 重心からランダムな方向に飛び散る
        for (let i = 0; i < numScatter; i++) {
            let m = getFragmentMass(numScatter - i);
            if (m < 0.1) continue;

            // 全方向にランダム
            let angle = Math.random() * Math.PI * 2;
            
            fragments.push({
                mass: m,
                vxRel: Math.cos(angle) * 1, // 初速は標準(1)
                vyRel: Math.sin(angle) * 1,
                type: 'scatter',
                angle: angle
            });
        }

        // 4. エネルギー保存則に基づいた速度スケーリング
        let currentKE = 0;
        for (let f of fragments) currentKE += 0.5 * f.mass * (f.vxRel**2 + f.vyRel**2);

        let scale = 0;
        if (currentKE > 0) scale = Math.sqrt(energyToMotion / currentKE);

        // 5. 最終的なオブジェクト生成
        for (let f of fragments) {
            let finalVx, finalVy, spawnX, spawnY, spawnRadius;

            // タイプによって挙動を分岐
            if (f.type === 'jet') {
                // ジェットはさらに加速させ、発生位置を少し散らす
                let speedMult = scale * (Math.random() * 3 + 3.0);
                finalVx = f.vxRel * speedMult;
                finalVy = f.vyRel * speedMult;
                
                // 衝突の中心付近から発生
                spawnX = (this.x + other.x) / 2;
                spawnY = (this.y + other.y) / 2;
                spawnRadius = Math.min(this.radius, other.radius);

                spawnRadius *= 0.2;

            } else {
                // 拡散破片は重心速度 + 相対速度
                let speedMult = scale * (Math.random() * 8.0 - 16.0);
                finalVx = comVx + f.vxRel * speedMult;
                finalVy = comVy + f.vyRel * speedMult;

                // どちらかの親オブジェクトの位置に近い場所から発生
                let fromFirst = Math.random() < 0.5;
                spawnX = fromFirst ? this.x : other.x;
                spawnY = fromFirst ? this.y : other.y;
                spawnRadius = fromFirst ? this.radius : other.radius;
                spawnRadius *=  ((Math.random()*1));
            }
            
            // 少し位置をずらして重なりを回避
            let spawnAngle = f.angle; 
            let posX = spawnX + Math.cos(spawnAngle) * spawnRadius * 1;
            let posY = spawnY + Math.sin(spawnAngle) * spawnRadius * 1;

            newObjects.push(new Object(
                posX, 
                posY, 
                f.mass, 
                finalVx, 
                finalVy,
                undefined, // ax
                undefined, // ay
                finalTemp + Math.sqrt(finalVx**2 + finalVy**2) * 5,
                undefined, // density
                Math.sqrt(f.mass / this.density), // radius
                5 // cooldown
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
    let mass = (Math.random() ** 3) * 10000; 
    newObjects.push(new Object(
        x, 
        y, 
        mass, 
        undefined, 
        undefined,
        undefined, 
        undefined, 
        10, 
        undefined, 
        undefined, 
        0 // cooldown
    ));
}

function init() {
    // for (let i = 0; i < 2; i++) { 
    //     addPlanet();
    // }
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


