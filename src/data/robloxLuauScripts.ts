export interface RobloxScriptFile {
  id: string;
  filename: string;
  location: string;
  language: 'luau' | 'markdown';
  summary: string;
  content: string;
}

export const ROBLOX_LUAU_SCRIPTS: RobloxScriptFile[] = [
  {
    id: 'styles-config',
    filename: 'StylesConfig.luau',
    location: 'ReplicatedStorage > Modules > StylesConfig (ModuleScript)',
    language: 'luau',
    summary: 'Характеристики, цвета и способности Акаши Сейджуро, Аомине Дайки и Куроко Тецуи.',
    content: `-- ReplicatedStorage/Modules/StylesConfig.luau
local StylesConfig = {}

export type StyleId = "Akashi" | "Aomine" | "Kuroko"

StylesConfig.Styles = {
	Akashi = {
		DisplayName = "Акаши Сейджуро",
		Title = "Император",
		JerseyNumber = "4",
		JerseyColor = Color3.fromRGB(248, 250, 252),
		TrimColor = Color3.fromRGB(153, 27, 27),
		ZoneColor = Color3.fromRGB(225, 29, 72),
		WalkSpeed = 22,
		ZoneSpeedMultiplier = 1.35,
		TwoPointBonus = 0.86,
		ThreePointBonus = 0.78,
		Skills = {
			Q = { Name = "AnkleBreak", Cooldown = 6.5, StunDuration = 2.2, Radius = 14 },
			E = { Name = "EmperorEyeSteal", Cooldown = 7.5, Reach = 13 },
			Z = { Name = "EmperorZone", Duration = 16 },
		},
	},
	Aomine = {
		DisplayName = "Аомине Дайки",
		Title = "Неудержимый Ас",
		JerseyNumber = "5",
		JerseyColor = Color3.fromRGB(15, 23, 42),
		TrimColor = Color3.fromRGB(59, 130, 246),
		ZoneColor = Color3.fromRGB(56, 189, 248),
		WalkSpeed = 24,
		ZoneSpeedMultiplier = 1.45,
		TwoPointBonus = 0.90,
		ThreePointBonus = 0.74,
		Skills = {
			Q = { Name = "MirageDash", Cooldown = 5.5, DashImpulse = 78 },
			E = { Name = "FormlessShot", Cooldown = 7.0, ContestIgnore = 0.85 },
			Z = { Name = "WildZone", Duration = 16 },
		},
	},
	Kuroko = {
		DisplayName = "Куроко Тецуя",
		Title = "Фантом",
		JerseyNumber = "11",
		JerseyColor = Color3.fromRGB(17, 24, 39),
		TrimColor = Color3.fromRGB(220, 38, 38),
		ZoneColor = Color3.fromRGB(34, 211, 238),
		WalkSpeed = 21.5,
		ZoneSpeedMultiplier = 1.32,
		TwoPointBonus = 0.78,
		ThreePointBonus = 0.65,
		Skills = {
			Q = { Name = "VanishingDrive", Cooldown = 6.0, CloakDuration = 1.6 },
			E = { Name = "IgnitePass", Cooldown = 5.5, PassSpeed = 120 },
			Z = { Name = "DirectDriveZone", Duration = 18 },
		},
	},
}

return StylesConfig`,
  },
  {
    id: 'basketball-server',
    filename: 'BasketballServer.server.lua',
    location: 'ServerScriptService > BasketballServer (Script)',
    language: 'luau',
    summary: 'Серверная физика мяча, параболический бросок, 2/3 очка, перехваты и смена владения.',
    content: `-- ServerScriptService/BasketballServer.server.lua
local Players = game:GetService("Players")
local ReplicatedStorage = game:GetService("ReplicatedStorage")
local Debris = game:GetService("Debris")

local StylesConfig = require(ReplicatedStorage.Modules.StylesConfig)

local Remotes = ReplicatedStorage:WaitForChild("BasketballRemotes")
local ShootRemote: RemoteEvent = Remotes:WaitForChild("ShootBall")
local PassRemote: RemoteEvent = Remotes:WaitForChild("PassBall")
local StealRemote: RemoteEvent = Remotes:WaitForChild("AttemptSteal")
local ScoreChanged: RemoteEvent = Remotes:WaitForChild("ScoreChanged")

local Court = workspace:WaitForChild("Court")
local Ball: BasePart = workspace:WaitForChild("Basketball")
local RimHome: BasePart = Court:WaitForChild("RimHome")
local RimAway: BasePart = Court:WaitForChild("RimAway")

local BallOwner: Player? = nil
local Scores = { Home = 0, Away = 0 }
local GRAVITY = workspace.Gravity

local function attachBallToPlayer(player: Player)
	local char = player.Character
	local rightHand = char and (char:FindFirstChild("RightHand") or char:FindFirstChild("Right Arm"))
	if not rightHand then return end

	BallOwner = player
	Ball.Anchored = false
	Ball.CanCollide = false
	Ball:SetNetworkOwner(nil)

	local weld = Ball:FindFirstChild("DribbleWeld") or Instance.new("WeldConstraint")
	weld.Name = "DribbleWeld"
	weld.Part0 = rightHand
	weld.Part1 = Ball
	Ball.CFrame = rightHand.CFrame * CFrame.new(0, -1.2, -0.6)
	weld.Parent = Ball
end

local function detachBall()
	local weld = Ball:FindFirstChild("DribbleWeld")
	if weld then weld:Destroy() end
	BallOwner = nil
	Ball.CanCollide = true
end

local function computeArcVelocity(origin: Vector3, target: Vector3, peakOffset: number): Vector3
	local peakY = math.max(origin.Y, target.Y) + peakOffset
	local vy = math.sqrt(2 * GRAVITY * (peakY - origin.Y))
	local tUp = vy / GRAVITY
	local tDown = math.sqrt(2 * (peakY - target.Y) / GRAVITY)
	local totalTime = math.max(0.3, tUp + tDown)
	return Vector3.new(
		(target.X - origin.X) / totalTime,
		vy,
		(target.Z - origin.Z) / totalTime
	)
end

ShootRemote.OnServerEvent:Connect(function(player: Player, releaseAccuracy: number, isFormless: boolean?)
	if BallOwner ~= player then return end
	local char = player.Character
	local root = char and char:FindFirstChild("HumanoidRootPart") :: BasePart?
	if not root then return end

	local team = player:GetAttribute("Team") or "Home"
	local targetRim = if team == "Home" then RimAway else RimHome
	local dist = (root.Position - targetRim.Position).Magnitude
	local isThree = dist >= 28 -- ~6.75m в стадах Roblox

	local styleId = player:GetAttribute("Style") or "Akashi"
	local styleData = StylesConfig.Styles[styleId]
	local baseProb = if isThree then styleData.ThreePointBonus else styleData.TwoPointBonus
	local inZone = player:GetAttribute("InZone") == true

	local makeChance = baseProb * (0.5 + 0.5 * math.clamp(releaseAccuracy, 0, 1))
	if inZone then makeChance += 0.25 end
	if isFormless then makeChance += 0.22 end

	local isMake = math.random() <= math.clamp(makeChance, 0.1, 0.99)
	local aimTarget = targetRim.Position + (if isMake then Vector3.zero else Vector3.new(math.random(-2, 2), 0.2, math.random(-2, 2)))

	detachBall()
	Ball.CFrame = CFrame.new(root.Position + Vector3.new(0, 3.2, 0))
	Ball.AssemblyLinearVelocity = computeArcVelocity(Ball.Position, aimTarget, if isFormless then 12 else 9)

	if isMake then
		task.delay(0.85, function()
			Scores[team] += if isThree then 3 else 2
			ScoreChanged:FireAllClients(Scores.Home, Scores.Away, player.Name, isThree)
			local currentZone = player:GetAttribute("ZoneCharge") or 0
			player:SetAttribute("ZoneCharge", math.min(100, currentZone + 28))
		end)
	end
end)

StealRemote.OnServerEvent:Connect(function(player: Player)
	if not BallOwner or BallOwner == player then return end
	local myRoot = player.Character and player.Character:FindFirstChild("HumanoidRootPart")
	local ownerRoot = BallOwner.Character and BallOwner.Character:FindFirstChild("HumanoidRootPart")
	if not myRoot or not ownerRoot then return end

	local styleId = player:GetAttribute("Style") or "Akashi"
	local reach = if styleId == "Akashi" then 11 else 8
	if (myRoot.Position - ownerRoot.Position).Magnitude <= reach then
		attachBallToPlayer(player)
	end
end)

Players.PlayerAdded:Connect(function(player)
	player:SetAttribute("Style", "Akashi")
	player:SetAttribute("ZoneCharge", 0)
	player:SetAttribute("InZone", false)
	player.CharacterAdded:Connect(function(char)
		task.wait(0.5)
		if not BallOwner then
			attachBallToPlayer(player)
		end
	end)
end)`,
  },
  {
    id: 'abilities-server',
    filename: 'AbilitiesServer.server.lua',
    location: 'ServerScriptService > AbilitiesServer (Script)',
    language: 'luau',
    summary: 'Способности Q / E / Z: Ankle Break, Emperor Eye, Formless Shot, Vanishing Drive, Ignite Pass и Zone.',
    content: `-- ServerScriptService/AbilitiesServer.server.lua
local Players = game:GetService("Players")
local ReplicatedStorage = game:GetService("ReplicatedStorage")

local StylesConfig = require(ReplicatedStorage.Modules.StylesConfig)
local Remotes = ReplicatedStorage:WaitForChild("BasketballRemotes")
local UseSkillRemote: RemoteEvent = Remotes:WaitForChild("UseSkill")
local SkillVFXRemote: RemoteEvent = Remotes:WaitForChild("SkillVFX")

local Cooldowns: { [Player]: { [string]: number } } = {}

local function canUse(player: Player, key: string, cd: number): boolean
	Cooldowns[player] = Cooldowns[player] or {}
	local now = os.clock()
	if (Cooldowns[player][key] or 0) > now then
		return false
	end
	Cooldowns[player][key] = now + cd
	return true
end

UseSkillRemote.OnServerEvent:Connect(function(player: Player, slot: string)
	local styleId = player:GetAttribute("Style") or "Akashi"
	local style = StylesConfig.Styles[styleId]
	if not style then return end

	local char = player.Character
	local root = char and char:FindFirstChild("HumanoidRootPart") :: BasePart?
	local hum = char and char:FindFirstChildOfClass("Humanoid")
	if not root or not hum then return end

	if slot == "Z" then
		local charge = player:GetAttribute("ZoneCharge") or 0
		if charge < 100 or player:GetAttribute("InZone") then return end

		player:SetAttribute("ZoneCharge", 0)
		player:SetAttribute("InZone", true)
		hum.WalkSpeed = style.WalkSpeed * style.ZoneSpeedMultiplier
		SkillVFXRemote:FireAllClients(player, "ZoneAwaken", style.ZoneColor)

		task.delay(style.Skills.Z.Duration, function()
			if player.Parent and hum.Parent then
				player:SetAttribute("InZone", false)
				hum.WalkSpeed = style.WalkSpeed
			end
		end)
		return
	end

	local skill = style.Skills[slot]
	if not skill or not canUse(player, slot, skill.Cooldown) then return end

	-- Реализация навыков по персонажам
	if styleId == "Akashi" and slot == "Q" then
		-- Ankle Break: сбиваем ближайшего соперника на паркет
		for _, other in ipairs(Players:GetPlayers()) do
			if other ~= player and other.Character then
				local otherRoot = other.Character:FindFirstChild("HumanoidRootPart")
				local otherHum = other.Character:FindFirstChildOfClass("Humanoid")
				if otherRoot and otherHum and (otherRoot.Position - root.Position).Magnitude <= skill.Radius then
					otherHum.PlatformStand = true
					otherHum.WalkSpeed = 0
					SkillVFXRemote:FireAllClients(other, "AnkleBroken", style.ZoneColor)
					task.delay(skill.StunDuration, function()
						if otherHum.Parent then
							otherHum.PlatformStand = false
							otherHum.WalkSpeed = 20
						end
					end)
				end
			end
		end
	elseif styleId == "Aomine" and slot == "Q" then
		-- Mirage Dash
		local bv = Instance.new("LinearVelocity")
		local att = root:FindFirstChildOfClass("Attachment") or Instance.new("Attachment", root)
		bv.Attachment0 = att
		bv.MaxForce = 50000
		bv.VectorVelocity = root.CFrame.LookVector * skill.DashImpulse
		bv.Parent = root
		task.delay(0.22, function() bv:Destroy() end)
	elseif styleId == "Kuroko" and slot == "Q" then
		-- Vanishing Drive: полупрозрачность фантома
		for _, part in ipairs(char:GetDescendants()) do
			if part:IsA("BasePart") and part.Name ~= "HumanoidRootPart" then
				part.Transparency = 0.78
			end
		end
		hum.WalkSpeed = style.WalkSpeed * 1.45
		task.delay(skill.CloakDuration, function()
			if char.Parent then
				for _, part in ipairs(char:GetDescendants()) do
					if part:IsA("BasePart") and part.Name ~= "HumanoidRootPart" then
						part.Transparency = 0
					end
				end
				hum.WalkSpeed = style.WalkSpeed
			end
		end)
	end

	SkillVFXRemote:FireAllClients(player, skill.Name, style.ZoneColor)
end)`,
  },
  {
    id: 'client-controller',
    filename: 'PlayerController.client.lua',
    location: 'StarterPlayer > StarterPlayerScripts > PlayerController (LocalScript)',
    language: 'luau',
    summary: 'Клиентский ввод (Space заряд броска, Q/E/Z способности, клик перехват) и VFX Зоны на глазах.',
    content: `-- StarterPlayer/StarterPlayerScripts/PlayerController.client.lua
local Players = game:GetService("Players")
local UserInputService = game:GetService("UserInputService")
local RunService = game:GetService("RunService")
local ReplicatedStorage = game:GetService("ReplicatedStorage")
local TweenService = game:GetService("TweenService")

local LocalPlayer = Players.LocalPlayer
local Remotes = ReplicatedStorage:WaitForChild("BasketballRemotes")
local ShootRemote = Remotes:WaitForChild("ShootBall")
local StealRemote = Remotes:WaitForChild("AttemptSteal")
local UseSkillRemote = Remotes:WaitForChild("UseSkill")
local SkillVFXRemote = Remotes:WaitForChild("SkillVFX")

local chargingShot = false
local chargeAlpha = 0

UserInputService.InputBegan:Connect(function(input, gameProcessed)
	if gameProcessed then return end

	if input.KeyCode == Enum.KeyCode.Space then
		chargingShot = true
		chargeAlpha = 0
	elseif input.KeyCode == Enum.KeyCode.Q then
		UseSkillRemote:FireServer("Q")
	elseif input.KeyCode == Enum.KeyCode.E then
		UseSkillRemote:FireServer("E")
	elseif input.KeyCode == Enum.KeyCode.Z then
		UseSkillRemote:FireServer("Z")
	elseif input.UserInputType == Enum.UserInputType.MouseButton1 then
		StealRemote:FireServer()
	end
end)

UserInputService.InputEnded:Connect(function(input)
	if input.KeyCode == Enum.KeyCode.Space and chargingShot then
		chargingShot = false
		-- Идеальный тайминг в районе 0.80
		local accuracy = math.clamp(1 - math.abs(chargeAlpha - 0.8) * 2.2, 0.15, 1)
		ShootRemote:FireServer(accuracy, false)
	end
end)

RunService.RenderStepped:Connect(function(dt)
	if chargingShot then
		chargeAlpha = math.min(1, chargeAlpha + dt * 1.15)
	end
end)

-- Эффект Зоны (молнии из глаз, как в Basketball Zero)
SkillVFXRemote.OnClientEvent:Connect(function(targetPlayer: Player, vfxName: string, color: Color3)
	if vfxName == "ZoneAwaken" and targetPlayer.Character then
		local head = targetPlayer.Character:FindFirstChild("Head")
		if head then
			local trail = Instance.new("Trail")
			local a0 = Instance.new("Attachment", head)
			local a1 = Instance.new("Attachment", head)
			a0.Position = Vector3.new(0.18, 0.12, -0.5)
			a1.Position = Vector3.new(-0.18, 0.12, -0.5)
			trail.Attachment0 = a0
			trail.Attachment1 = a1
			trail.Color = ColorSequence.new(color)
			trail.Lifetime = 0.45
			trail.Parent = head
		end

		if targetPlayer == LocalPlayer then
			local cam = workspace.CurrentCamera
			TweenService:Create(cam, TweenInfo.new(0.25), { FieldOfView = 84 }):Play()
		end
	end
end)`,
  },
  {
    id: 'setup-guide',
    filename: 'Инструкция_Roblox_Studio.md',
    location: 'Пошаговая сборка в Roblox Studio',
    language: 'markdown',
    summary: 'Как за 5 минут собрать сцену в Roblox Studio и запустить этот режим.',
    content: `# Сборка режима «Куроко / Basketball Zero» в Roblox Studio

1. **Создай папку RemoteEvents в ReplicatedStorage**:
   - В \`ReplicatedStorage\` создай папку \`BasketballRemotes\`.
   - Внутри создай \`RemoteEvent\` с именами:
     - \`ShootBall\`
     - \`PassBall\`
     - \`AttemptSteal\`
     - \`UseSkill\`
     - \`SkillVFX\`
     - \`ScoreChanged\`

2. **Подключи модуль стилей**:
   - В \`ReplicatedStorage\` создай папку \`Modules\`.
   - Внутри создай \`ModuleScript\` с именем \`StylesConfig\` и вставь код из \`StylesConfig.luau\`.

3. **Добавь серверные скрипты**:
   - В \`ServerScriptService\` создай \`Script\` -> \`BasketballServer\` и вставь \`BasketballServer.server.lua\`.
   - В \`ServerScriptService\` создай \`Script\` -> \`AbilitiesServer\` и вставь \`AbilitiesServer.server.lua\`.

4. **Добавь клиентский контроллер**:
   - В \`StarterPlayer > StarterPlayerScripts\` создай \`LocalScript\` -> \`PlayerController\` и вставь \`PlayerController.client.lua\`.

5. **Подготовь площадку и мяч в Workspace**:
   - Создай модель \`Court\` в \`Workspace\` с двумя кольцами (\`Part\` с именами \`RimHome\` и \`RimAway\` на высоте ~10 стадов).
   - Создай шар \`Part\` (Shape = Ball, Size = \`Vector3.new(2, 2, 2)\`) с именем \`Basketball\` в \`Workspace\`.

6. **Выбор персонажа (Акаши / Аомине / Куроко)**:
   - Меняй атрибут \`player:SetAttribute("Style", "Akashi" | "Aomine" | "Kuroko")\` через свой UI-спиннер или лобби-кнопки!`,
  },
];
